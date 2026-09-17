import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractSinToken, rejectionGuardService, shouldEnforceRejectionGuard } from "../services/rejection-guard.js";

// Mock the db layer: the service queries the approvals table directly. We
// only need the rows that look like recent rejected approvals; everything
// else (create / update / etc.) is irrelevant to the guard verdict.

interface MockApprovalRow {
  id: string;
  companyId: string;
  status: string;
  payload: Record<string, unknown>;
  decidedAt: Date;
  decidedByUserId: string | null;
}

/**
 * Build a fake drizzle query builder that filters rows by:
 *   - companyId (eq)
 *   - status (eq)
 *   - decidedAt (gte cutoff — applied via the orderBy callback)
 * and supports `orderBy(desc(approvals.decidedAt))`.
 *
 * We intercept the chained drizzle SQL via a stack of fragments. Each `eq(col, val)`
 * and `gte(col, val)` produces a SQL chunk whose queryChunks contains the column
 * reference (with `.name`) and the value. We accumulate those, then evaluate
 * them against our row array when `orderBy` resolves the chain.
 */
function createMockDb(allRows: MockApprovalRow[], opts: { now?: Date; windowDays?: number } = {}) {
  const now = opts.now ?? new Date("2026-09-16T16:05:00.000Z");
  const windowMs = (opts.windowDays ?? 7) * 24 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - windowMs);

  // Recursively walk drizzle SQL chunks to extract every eq / gte predicate.
  // Drizzle structures each leaf predicate as a SQL wrapper with length-5 chunks:
  //   ["", Column{name}, StringChunk{value:[" op "]}, Param{value:V}, ""]
  // An `and()` of predicates produces nested groups. The tree shape is:
  //   and()          -> SQL qc=3 [ "(", and-wrapper, ")" ]
  //   and-wrapper    -> SQL qc=5 [ leaf, " and ", leaf, " and ", leaf ]
  //   leaf           -> SQL qc=5 [ "", Column, opString, Param{value:V}, "" ]
  // Walk recursively and pick out every length-5 SQL whose chunks[1] is a
  // Column-shaped object (has .name) AND whose chunks[2] is a StringChunk
  // describing the operator. The value comes from a Param wrapper at chunks[3].
  function isColumnObject(obj: any): boolean {
    return (
      obj !== null &&
      typeof obj === "object" &&
      !Array.isArray(obj) &&
      !Array.isArray((obj as any).queryChunks) &&
      typeof (obj as any).name === "string"
    );
  }
  function isStringChunk(obj: any): boolean {
    return (
      obj !== null &&
      typeof obj === "object" &&
      !Array.isArray(obj) &&
      Array.isArray((obj as any).value)
    );
  }
  function unwrapParam(v: any): unknown {
    if (v === null || v === undefined) return v;
    if (v instanceof Date) return v;
    if (typeof v !== "object") return v;
    if (Array.isArray((v as any).queryChunks)) return v;
    if (Object.prototype.hasOwnProperty.call(v, "value") && !Array.isArray((v as any).value)) {
      return (v as any).value;
    }
    return v;
  }

  type Leaf = { op: "eq" | "gte" | "other"; name: string; value: unknown };
  const captured: Leaf[] = [];

  function walk(sql: any) {
    if (!sql || typeof sql !== "object" || !Array.isArray(sql.queryChunks)) return;
    const chunks = sql.queryChunks as any[];
    const lookLikeLeaf =
      chunks.length === 5 && isColumnObject(chunks[1]) && isStringChunk(chunks[2]);
    if (lookLikeLeaf) {
      const opArr = (chunks[2] as any).value as string[];
      const op = opArr.join("").trim();
      const name = (chunks[1] as any).name as string;
      const value = unwrapParam(chunks[3]);
      if (op.includes(">=")) captured.push({ op: "gte", name, value });
      else if (op.includes("=")) captured.push({ op: "eq", name, value });
      else captured.push({ op: "other", name, value });
      return;
    }
    for (const ch of chunks) {
      if (ch && typeof ch === "object" && Array.isArray((ch as any).queryChunks)) {
        walk(ch);
      }
    }
  }

  const rowColumnNames: Record<string, keyof MockApprovalRow> = {
    company_id: "companyId",
    status: "status",
    decided_at: "decidedAt",
  };

  const table: any = {
    select: vi.fn(function (this: any) {
      return this;
    }),
    from: vi.fn(function (this: any) {
      return this;
    }),
    where: vi.fn(function (this: any, predicate: any) {
      captured.length = 0;
      walk(predicate);
      return this;
    }),
    orderBy: vi.fn(async function (this: any) {
      const eqPredicates = captured.filter((p) => p.op === "eq");
      const gtePredicates = captured.filter((p) => p.op === "gte");
      const filtered = allRows.filter((row) => {
        for (const p of eqPredicates) {
          const rowKey = rowColumnNames[p.name] ?? (p.name as keyof MockApprovalRow);
          const rowValue = (row as any)[rowKey];
          if (rowValue !== p.value) return false;
        }
        for (const p of gtePredicates) {
          const rowKey = rowColumnNames[p.name] ?? (p.name as keyof MockApprovalRow);
          const rowValue = (row as any)[rowKey];
          if (rowValue instanceof Date && p.value instanceof Date && rowValue.getTime() < p.value.getTime()) {
            return false;
          }
        }
        return true;
      });
      filtered.sort((a, b) => {
        const aTime = a.decidedAt ? a.decidedAt.getTime() : 0;
        const bTime = b.decidedAt ? b.decidedAt.getTime() : 0;
        return bTime - aTime;
      });
      return filtered;
    }),
  };
  return table;
}

describe("extractSinToken", () => {
  it("extracts SIN-<digits> tokens from arbitrary strings", () => {
    expect(extractSinToken("CEO Review: SIN-1794 Plan Approval Monitor promotion to production vault")).toBe(
      "SIN-1794",
    );
    expect(extractSinToken("Promote SIN-1492 vault")).toBe("SIN-1492");
    expect(extractSinToken("[SIN-7] tiny")).toBe("SIN-7");
  });

  it("returns null when no SIN token is present", () => {
    expect(extractSinToken("no identifier here")).toBeNull();
    expect(extractSinToken(null)).toBeNull();
    expect(extractSinToken(undefined)).toBeNull();
    expect(extractSinToken("")).toBeNull();
  });

  it("normalises the token to uppercase", () => {
    expect(extractSinToken("sin-42 something")).toBe("SIN-42");
  });
});

describe("shouldEnforceRejectionGuard", () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.APPROVAL_GUARD_DISABLE;
  });

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  it("enforces by default for agent-initiated approvals", () => {
    expect(
      shouldEnforceRejectionGuard({
        requestedByAgentId: "agent-1",
        requestedByUserId: null,
        payload: { title: "Promote SIN-1 vault" },
      }),
    ).toBe(true);
  });

  it("bypasses when requestedByUserId is set (FR-5 override)", () => {
    expect(
      shouldEnforceRejectionGuard({
        requestedByAgentId: "agent-1",
        requestedByUserId: "user-1",
        payload: { title: "Promote SIN-1 vault" },
      }),
    ).toBe(false);
  });

  it("bypasses when the kill-switch env is set", () => {
    process.env.APPROVAL_GUARD_DISABLE = "true";
    expect(
      shouldEnforceRejectionGuard({
        requestedByAgentId: "agent-1",
        payload: { title: "Promote SIN-1 vault" },
      }),
    ).toBe(false);
  });

  it("bypasses when caller explicitly requests bypass", () => {
    expect(
      shouldEnforceRejectionGuard({
        requestedByAgentId: "agent-1",
        payload: { title: "Promote SIN-1 vault" },
        bypass: true,
      }),
    ).toBe(false);
  });
});

describe("rejectionGuardService.check (deterministic scenarios)", () => {
  const fixedNow = new Date("2026-09-16T16:05:00.000Z");

  function makeDb(rows: MockApprovalRow[], windowDays = 7) {
    return createMockDb(rows, { now: fixedNow, windowDays }) as unknown as Parameters<typeof rejectionGuardService>[0];
  }

  it("FR-3 — two rejected approvals with identical titles but different SIN ids → only the matching fingerprint is matched", async () => {
    const rows: MockApprovalRow[] = [
      {
        id: "rej-sin-100",
        companyId: "company-1",
        status: "rejected",
        payload: { title: "CEO Review: SIN-100 vault promotion", summary: "SOP body" },
        decidedAt: new Date("2026-09-16T16:00:00.000Z"),
        decidedByUserId: "chairman-1",
      },
      {
        id: "rej-sin-200",
        companyId: "company-1",
        status: "rejected",
        payload: { title: "CEO Review: SIN-200 vault promotion", summary: "SOP body" },
        decidedAt: new Date("2026-09-16T16:00:30.000Z"),
        decidedByUserId: "chairman-1",
      },
    ];
    const svc = rejectionGuardService(makeDb(rows));

    const sameFingerprint = await svc.check(
      "company-1",
      { title: "CEO Review: SIN-100 vault promotion", summary: "SOP body" },
      { now: () => fixedNow, windowDays: 7 },
    );
    expect(sameFingerprint.fingerprintSinId).toBe("SIN-100");
    expect(sameFingerprint.matched).toBe(true);
    expect(sameFingerprint.matches.map((m) => m.approvalId)).toEqual(["rej-sin-100"]);

    const differentFingerprint = await svc.check(
      "company-1",
      { title: "CEO Review: SIN-200 vault promotion", summary: "SOP body" },
      { now: () => fixedNow, windowDays: 7 },
    );
    expect(differentFingerprint.fingerprintSinId).toBe("SIN-200");
    expect(differentFingerprint.matched).toBe(true);
    expect(differentFingerprint.matches.map((m) => m.approvalId)).toEqual(["rej-sin-200"]);
  });

  it("FR-3 — identical titles but only one carries a SIN id → only that one matches", async () => {
    const rows: MockApprovalRow[] = [
      {
        id: "rej-sin-1794",
        companyId: "company-1",
        status: "rejected",
        payload: { title: "Promote SIN-1794 Plan Approval Monitor" },
        decidedAt: new Date("2026-09-16T15:59:58.000Z"),
        decidedByUserId: "chairman-1",
      },
    ];
    const svc = rejectionGuardService(makeDb(rows));

    const sin1794 = await svc.check(
      "company-1",
      { title: "Promote SIN-1794 Plan Approval Monitor (retry)" },
      { now: () => fixedNow, windowDays: 7 },
    );
    expect(sin1794.matched).toBe(true);
    expect(sin1794.matches.map((m) => m.approvalId)).toEqual(["rej-sin-1794"]);

    const sin1795 = await svc.check(
      "company-1",
      { title: "Promote SIN-1795 Plan Approval Monitor" },
      { now: () => fixedNow, windowDays: 7 },
    );
    expect(sin1795.matched).toBe(false);
    expect(sin1795.matches).toHaveLength(0);
  });

  it("FR-4 — fresh SIN id with no prior rejection → approval proceeds", async () => {
    const rows: MockApprovalRow[] = [
      {
        id: "rej-sin-other",
        companyId: "company-1",
        status: "rejected",
        payload: { title: "Promote SIN-999 vault" },
        decidedAt: new Date("2026-09-16T15:59:00.000Z"),
        decidedByUserId: "chairman-1",
      },
    ];
    const svc = rejectionGuardService(makeDb(rows));

    const verdict = await svc.check(
      "company-1",
      { title: "Promote SIN-1000 vault" },
      { now: () => fixedNow, windowDays: 7 },
    );
    expect(verdict.fingerprintSinId).toBe("SIN-1000");
    expect(verdict.matched).toBe(false);
    expect(verdict.matches).toHaveLength(0);
  });

  it("FR-5 — bypass flag suppresses the verdict for user-initiated requests", async () => {
    const rows: MockApprovalRow[] = [
      {
        id: "rej-sin-1794",
        companyId: "company-1",
        status: "rejected",
        payload: { title: "Promote SIN-1794 Plan Approval Monitor" },
        decidedAt: new Date("2026-09-16T15:59:58.000Z"),
        decidedByUserId: "chairman-1",
      },
    ];
    const svc = rejectionGuardService(makeDb(rows));

    const verdict = await svc.check(
      "company-1",
      { title: "Promote SIN-1794 Plan Approval Monitor" },
      { now: () => fixedNow, windowDays: 7, bypass: true },
    );
    expect(verdict.matched).toBe(false);
    expect(verdict.fingerprintSinId).toBeNull();
  });

  it("rejections outside the configured window do not suppress new requests", async () => {
    const rows: MockApprovalRow[] = [
      {
        id: "rej-sin-old",
        companyId: "company-1",
        status: "rejected",
        payload: { title: "Promote SIN-1794 vault" },
        decidedAt: new Date("2026-09-01T15:59:58.000Z"), // ~15 days ago
        decidedByUserId: "chairman-1",
      },
    ];
    const svc = rejectionGuardService(makeDb(rows));

    const verdict = await svc.check(
      "company-1",
      { title: "Promote SIN-1794 vault" },
      { now: () => fixedNow, windowDays: 7 },
    );
    expect(verdict.fingerprintSinId).toBe("SIN-1794");
    expect(verdict.matched).toBe(false);
    expect(verdict.matches).toHaveLength(0);
  });

  it("non-rejected approval rows are ignored even when fingerprint matches", async () => {
    const rows: MockApprovalRow[] = [
      {
        id: "app-sin-1794",
        companyId: "company-1",
        status: "approved", // explicitly approved, not rejected
        payload: { title: "Promote SIN-1794 vault" },
        decidedAt: new Date("2026-09-16T15:00:00.000Z"),
        decidedByUserId: "chairman-1",
      },
      {
        id: "pen-sin-1794",
        companyId: "company-1",
        status: "pending",
        payload: { title: "Promote SIN-1794 vault" },
        decidedAt: null as unknown as Date,
        decidedByUserId: null,
      },
    ];
    const svc = rejectionGuardService(makeDb(rows));
    const verdict = await svc.check(
      "company-1",
      { title: "Promote SIN-1794 vault" },
      { now: () => fixedNow, windowDays: 7 },
    );
    expect(verdict.matched).toBe(false);
    expect(verdict.matches).toHaveLength(0);
  });

  it("company isolation: rejections in another company are not surfaced", async () => {
    const rows: MockApprovalRow[] = [
      {
        id: "rej-sin-1794-other",
        companyId: "company-2", // different company
        status: "rejected",
        payload: { title: "Promote SIN-1794 vault" },
        decidedAt: new Date("2026-09-16T15:59:58.000Z"),
        decidedByUserId: "chairman-other",
      },
    ];
    const svc = rejectionGuardService(makeDb(rows));
    const verdict = await svc.check(
      "company-1",
      { title: "Promote SIN-1794 vault" },
      { now: () => fixedNow, windowDays: 7 },
    );
    expect(verdict.fingerprintSinId).toBe("SIN-1794");
    expect(verdict.matched).toBe(false);
    expect(verdict.matches).toHaveLength(0);
  });

  it("falls back to payload.summary / payload.link when title carries no token", async () => {
    const rows: MockApprovalRow[] = [
      {
        id: "rej-sin-1794-summary",
        companyId: "company-1",
        status: "rejected",
        payload: {
          title: "Generic approval request",
          summary: "Re-evaluating SIN-1794 vault content",
        },
        decidedAt: new Date("2026-09-16T15:59:58.000Z"),
        decidedByUserId: "chairman-1",
      },
    ];
    const svc = rejectionGuardService(makeDb(rows));
    const verdict = await svc.check(
      "company-1",
      { title: "Generic approval request", summary: "Re-evaluating SIN-1794 vault content" },
      { now: () => fixedNow, windowDays: 7 },
    );
    expect(verdict.fingerprintSinId).toBe("SIN-1794");
    expect(verdict.matched).toBe(true);
    expect(verdict.matches.map((m) => m.approvalId)).toEqual(["rej-sin-1794-summary"]);
  });

  it("returns matched=true with multiple matches when the user rejected several times in-window", async () => {
    const rows: MockApprovalRow[] = [
      {
        id: "rej-sin-1794-a",
        companyId: "company-1",
        status: "rejected",
        payload: { title: "Promote SIN-1794 vault" },
        decidedAt: new Date("2026-09-16T15:59:58.000Z"),
        decidedByUserId: "chairman-1",
      },
      {
        id: "rej-sin-1794-b",
        companyId: "company-1",
        status: "rejected",
        payload: { title: "Promote SIN-1794 vault" },
        decidedAt: new Date("2026-09-16T16:00:50.000Z"),
        decidedByUserId: "chairman-1",
      },
    ];
    const svc = rejectionGuardService(makeDb(rows));
    const verdict = await svc.check(
      "company-1",
      { title: "Promote SIN-1794 vault" },
      { now: () => fixedNow, windowDays: 7 },
    );
    expect(verdict.matched).toBe(true);
    expect(verdict.matches.map((m) => m.approvalId)).toEqual(["rej-sin-1794-b", "rej-sin-1794-a"]);
  });

  it("SIN-1794 / ee024213 deterministic scenario: re-fire within seconds of rejection is suppressed", async () => {
    // Phase 1 fixture — user rejected at 15:59:58, routine re-fired at 16:01:37.
    const rows: MockApprovalRow[] = [
      {
        id: "773a7767-original-rejection",
        companyId: "company-1",
        status: "rejected",
        payload: { title: "CEO Review: SIN-1794 Plan Approval Monitor promotion to production vault" },
        decidedAt: new Date("2026-09-16T15:59:58.000Z"),
        decidedByUserId: "chairman-1",
      },
    ];
    const svc = rejectionGuardService(makeDb(rows));
    const reFireTime = new Date("2026-09-16T16:01:37.000Z");
    const verdict = await svc.check(
      "company-1",
      { title: "CEO Review: SIN-1794 Plan Approval Monitor promotion to production vault" },
      { now: () => reFireTime, windowDays: 7 },
    );
    expect(verdict.fingerprintSinId).toBe("SIN-1794");
    expect(verdict.matched).toBe(true);
    expect(verdict.matches.map((m) => m.approvalId)).toEqual(["773a7767-original-rejection"]);
  });
});

describe("rejectionGuardService environment overrides", () => {
  const fixedNow = new Date("2026-09-16T16:05:00.000Z");
  const previousEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  function makeDb(rows: MockApprovalRow[], windowDays = 7) {
    return createMockDb(rows, { now: fixedNow, windowDays }) as unknown as Parameters<typeof rejectionGuardService>[0];
  }

  it("honours APPROVAL_GUARD_WINDOW_DAYS override", async () => {
    process.env.APPROVAL_GUARD_WINDOW_DAYS = "14";
    const rows: MockApprovalRow[] = [
      {
        id: "rej-sin-10-day-old",
        companyId: "company-1",
        status: "rejected",
        payload: { title: "Promote SIN-1794 vault" },
        decidedAt: new Date("2026-09-06T15:59:58.000Z"), // 10 days ago
        decidedByUserId: "chairman-1",
      },
    ];
    const svc = rejectionGuardService(makeDb(rows));
    const verdict = await svc.check(
      "company-1",
      { title: "Promote SIN-1794 vault" },
      { now: () => fixedNow },
    );
    expect(verdict.matched).toBe(true);
    expect(verdict.matches).toHaveLength(1);
  });

  it("kill-switch APPROVAL_GUARD_DISABLE suppresses the verdict", async () => {
    process.env.APPROVAL_GUARD_DISABLE = "1";
    const rows: MockApprovalRow[] = [
      {
        id: "rej-sin-fresh",
        companyId: "company-1",
        status: "rejected",
        payload: { title: "Promote SIN-1794 vault" },
        decidedAt: new Date("2026-09-16T15:59:58.000Z"),
        decidedByUserId: "chairman-1",
      },
    ];
    const svc = rejectionGuardService(makeDb(rows));
    const verdict = await svc.check(
      "company-1",
      { title: "Promote SIN-1794 vault" },
      { now: () => fixedNow },
    );
    expect(verdict.matched).toBe(false);
    expect(verdict.fingerprintSinId).toBeNull();
  });
});
