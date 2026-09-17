import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvals } from "@paperclipai/db";

/**
 * Internal interface that lets the unit tests inject a deterministic row
 * source without standing up an actual drizzle query builder. Production
 * uses the default {@link defaultQueryRecentRejections} which goes through
 * the live db.
 */
export interface RecentRejectionsQuery {
  (input: {
    companyId: string;
    cutoff: Date;
  }): Promise<
    Array<{
      id: string;
      payload: Record<string, unknown>;
      decidedAt: Date | null;
      decidedByUserId: string | null;
      status: string;
    }>
  >;
}

/**
 * Rejected-SIN approval guard.
 *
 * Suppresses agent-initiated approvals whose SIN fingerprint was already
 * rejected inside the configured window. Implementation of SIN-2096 P3
 * (Sophia Ergon). Fingerprint is the `SIN-<digits>` token extracted from
 * approval.title (preferred) or payload.title (fallback); title edits do
 * not bypass the guard because the fingerprint is normalised to the token,
 * not the raw title text.
 */

export const DEFAULT_REJECTION_WINDOW_DAYS = 7;
export const REJECTION_GUARD_WINDOW_ENV = "APPROVAL_GUARD_WINDOW_DAYS";
/** Disable flag for kill-switch wiring (Stratos / Jordan Chen). */
export const REJECTION_GUARD_DISABLE_ENV = "APPROVAL_GUARD_DISABLE";
export const SIN_TOKEN_PATTERN = /SIN-\d+/i;

export interface RejectedSinMatch {
  /** Canonical SIN identifier token (e.g. `SIN-1794`). */
  sinId: string;
  /** Approval id of the prior rejection. */
  approvalId: string;
  /** Timestamp the rejection was decided. */
  rejectedAt: Date;
  /** User who decided the rejection. */
  decidedByUserId: string | null;
}

export interface RejectionGuardOptions {
  /** Rejection window in days. Defaults to env or 7. */
  windowDays?: number;
  /** Optional clock for deterministic tests. */
  now?: () => Date;
}

export interface RejectionGuardCheck {
  fingerprintSinId: string | null;
  matches: RejectedSinMatch[];
  matched: boolean;
}

/**
 * Extract the canonical SIN identifier token from a candidate string.
 * Returns `null` when the string does not contain a `SIN-<digits>` token.
 *
 * Examples:
 *   extractSinToken("CEO Review: SIN-1794 Plan Approval Monitor") === "SIN-1794"
 *   extractSinToken("Promote SIN-1492 vault")                    === "SIN-1492"
 *   extractSinToken("no identifier here")                       === null
 */
export function extractSinToken(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const match = input.match(SIN_TOKEN_PATTERN);
  if (!match) return null;
  return match[0].toUpperCase();
}

function readWindowDays(opts?: RejectionGuardOptions): number {
  if (typeof opts?.windowDays === "number" && Number.isFinite(opts.windowDays) && opts.windowDays > 0) {
    return Math.floor(opts.windowDays);
  }
  const raw = process.env[REJECTION_GUARD_WINDOW_ENV];
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_REJECTION_WINDOW_DAYS;
}

function isGuardDisabled(): boolean {
  const raw = process.env[REJECTION_GUARD_DISABLE_ENV];
  return raw === "1" || raw === "true";
}

export function rejectionGuardService(db: Db) {
  /**
   * Resolve the fingerprint for a pending approval. The order of preference:
   *   1. payload.title
   *   2. payload.summary (fallback when the title is generic)
   *   3. payload.link (e.g. "/SIN/issues/SIN-1794")
   * The caller may pass an explicit `candidateTitles` list to override.
   */
  function fingerprintFor(payload: Record<string, unknown>, candidateTitles?: string[]): string | null {
    const titles: string[] = [];
    if (Array.isArray(candidateTitles)) {
      for (const t of candidateTitles) {
        if (typeof t === "string" && t.length > 0) titles.push(t);
      }
    }
    const payloadTitle = typeof payload.title === "string" ? payload.title : null;
    if (payloadTitle) titles.push(payloadTitle);
    const payloadSummary = typeof payload.summary === "string" ? payload.summary : null;
    if (payloadSummary) titles.push(payloadSummary);
    const payloadLink = typeof payload.link === "string" ? payload.link : null;
    if (payloadLink) titles.push(payloadLink);
    for (const candidate of titles) {
      const token = extractSinToken(candidate);
      if (token) return token;
    }
    return null;
  }

  /**
   * Look for recent rejected approvals in `companyId` whose SIN fingerprint
   * matches `fingerprintSinId`. Returns the list of matches (empty list =
   * fresh or stale fingerprint).
   */
  async function lookupRecentRejections(
    companyId: string,
    fingerprintSinId: string,
    opts?: RejectionGuardOptions,
  ): Promise<RejectedSinMatch[]> {
    const now = (opts?.now ?? (() => new Date()))();
    const windowDays = readWindowDays(opts);
    const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        id: approvals.id,
        payload: approvals.payload,
        decidedAt: approvals.decidedAt,
        decidedByUserId: approvals.decidedByUserId,
        status: approvals.status,
      })
      .from(approvals)
      .where(
        and(
          eq(approvals.companyId, companyId),
          eq(approvals.status, "rejected"),
          gte(approvals.decidedAt, cutoff),
        ),
      )
      .orderBy(desc(approvals.decidedAt));

    const needle = fingerprintSinId.toUpperCase();
    const matches: RejectedSinMatch[] = [];
    for (const row of rows) {
      const fp = fingerprintFor((row.payload ?? {}) as Record<string, unknown>);
      if (fp !== needle) continue;
      matches.push({
        sinId: needle,
        approvalId: row.id,
        rejectedAt: row.decidedAt ?? cutoff,
        decidedByUserId: row.decidedByUserId ?? null,
      });
    }
    return matches;
  }

  /**
   * Convenience helper used by the routine layer (defense in depth) before
   * it constructs an approval request. Returns the guard verdict.
   */
  async function check(
    companyId: string,
    payload: Record<string, unknown>,
    opts?: RejectionGuardOptions & { candidateTitles?: string[]; bypass?: boolean },
  ): Promise<RejectionGuardCheck> {
    if (isGuardDisabled() || opts?.bypass) {
      return { fingerprintSinId: null, matches: [], matched: false };
    }
    const fingerprintSinId = fingerprintFor(payload, opts?.candidateTitles);
    if (!fingerprintSinId) {
      return { fingerprintSinId: null, matches: [], matched: false };
    }
    const matches = await lookupRecentRejections(companyId, fingerprintSinId, opts);
    return { fingerprintSinId, matches, matched: matches.length > 0 };
  }

  return {
    extractSinToken,
    fingerprintFor,
    lookupRecentRejections,
    check,
    isGuardDisabled,
    getWindowDays: () => readWindowDays(),
  };
}

export type RejectionGuardService = ReturnType<typeof rejectionGuardService>;

/**
 * Suppression reason string returned in the 422 body and in the activity log
 * so the routine layer can surface a stable error to the operator.
 */
export const REJECTION_GUARD_BLOCK_REASON = "rejected_sin_guard";
export const REJECTION_GUARD_BLOCK_MESSAGE =
  "Approval suppressed: SIN id was rejected within the guard window.";

/**
 * Internal helper for the route layer: decide whether a given create-approval
 * request must be rejected. Centralised so the test suite can exercise it
 * without spinning an HTTP server.
 */
export function shouldEnforceRejectionGuard(input: {
  requestedByUserId?: string | null;
  requestedByAgentId?: string | null;
  payload?: Record<string, unknown> | null;
  bypass?: boolean;
}): boolean {
  if (input.bypass) return false;
  if (isGuardDisabled()) return false;
  // User-initiated approvals always bypass the guard. This is the FR-5
  // override path: a human explicitly requested this, so honour it.
  if (input.requestedByUserId) return false;
  // Agent-initiated approvals (no userId, with an agent id) are in scope.
  // If neither user nor agent is set we still evaluate – the body may be a
  // system-issued prompt (e.g. plugin-managed hire approvals) which should
  // also be guarded against re-firing previously rejected content.
  return true;
}
