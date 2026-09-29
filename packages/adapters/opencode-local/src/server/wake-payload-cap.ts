import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export const DEFAULT_PAPERCLIP_WAKE_COMMENT_MAX_BYTES = 16 * 1024;
export const DEFAULT_PAPERCLIP_WAKE_OVERFLOW_DIR =
  "/datadrive/sc_vault/Shared_Services/Tech/wake-payload-overflow/";

export type WakePayloadCapReason =
  | "under_cap"
  | "at_cap"
  | "over_cap"
  | "overflow_dir_unwritable"
  | "cap_disabled";

export type WakePayloadCapInput = {
  runId: string;
  wakePrompt: string;
  env: Record<string, string>;
  now?: () => Date;
  fileWriter?: (filePath: string, body: string) => Promise<void>;
};

export type WakePayloadCapResult = {
  wakePrompt: string;
  truncated: boolean;
  originalBytes: number;
  cappedBytes: number;
  capBytes: number;
  overflowFilePath: string | null;
  sha256: string;
  reason: WakePayloadCapReason;
};

function readEnvInt(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function resolveCapBytes(input: WakePayloadCapInput): number | null {
  const fromRunEnv = readEnvInt(input.env.PAPERCLIP_WAKE_COMMENT_MAX_BYTES);
  if (fromRunEnv !== null) return fromRunEnv === 0 ? null : fromRunEnv;
  const fromProcessEnv = readEnvInt(process.env.PAPERCLIP_WAKE_COMMENT_MAX_BYTES);
  if (fromProcessEnv !== null) return fromProcessEnv === 0 ? null : fromProcessEnv;
  return DEFAULT_PAPERCLIP_WAKE_COMMENT_MAX_BYTES;
}

function resolveOverflowDir(input: WakePayloadCapInput): string {
  const fromRunEnv = input.env.PAPERCLIP_WAKE_OVERFLOW_DIR?.trim();
  if (fromRunEnv) return fromRunEnv;
  const fromProcessEnv = process.env.PAPERCLIP_WAKE_OVERFLOW_DIR?.trim();
  if (fromProcessEnv) return fromProcessEnv;
  return DEFAULT_PAPERCLIP_WAKE_OVERFLOW_DIR;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sanitizeRunIdForFilename(runId: string): string {
  const safe = runId
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._\-]+/, "")
    .slice(0, 80);
  return safe || "run";
}

async function ensureOverflowDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function applyWakeCommentMaxBytesCap(
  input: WakePayloadCapInput,
): Promise<WakePayloadCapResult> {
  const originalBytes = Buffer.byteLength(input.wakePrompt, "utf8");
  const sha256 = sha256Hex(input.wakePrompt);
  const capBytes = resolveCapBytes(input);
  if (capBytes === null) {
    return {
      wakePrompt: input.wakePrompt,
      truncated: false,
      originalBytes,
      cappedBytes: originalBytes,
      capBytes: 0,
      overflowFilePath: null,
      sha256,
      reason: "cap_disabled",
    };
  }
  if (originalBytes <= capBytes) {
    return {
      wakePrompt: input.wakePrompt,
      truncated: false,
      originalBytes,
      cappedBytes: originalBytes,
      capBytes,
      overflowFilePath: null,
      sha256,
      reason: originalBytes === capBytes ? "at_cap" : "under_cap",
    };
  }
  const overflowDir = resolveOverflowDir(input);
  const now = input.now ?? (() => new Date());
  const ts = now().toISOString().replace(/[:.]/g, "-");
  const runSegment = sanitizeRunIdForFilename(input.runId);
  const fileName = `${runSegment}-${ts}.md`;
  const overflowFilePath = path.join(overflowDir, fileName);
  const writer =
    input.fileWriter ??
    (async (p: string, body: string) => {
      await ensureOverflowDir(path.dirname(p));
      await fs.writeFile(p, body, "utf8");
    });
  try {
    await writer(overflowFilePath, input.wakePrompt);
  } catch {
    return {
      wakePrompt: input.wakePrompt,
      truncated: false,
      originalBytes,
      cappedBytes: originalBytes,
      capBytes,
      overflowFilePath: null,
      sha256,
      reason: "overflow_dir_unwritable",
    };
  }
  const stub = [
    `[Paperclip wake payload truncated] original=${originalBytes}B cap=${capBytes}B`,
    `path=${overflowFilePath}`,
    `sha256=${sha256}`,
    "Read the file at <path> for the full wake context.",
  ].join("\n");
  const cappedBytes = Buffer.byteLength(stub, "utf8");
  return {
    wakePrompt: stub,
    truncated: true,
    originalBytes,
    cappedBytes,
    capBytes,
    overflowFilePath,
    sha256,
    reason: "over_cap",
  };
}

export function resolveWakeOverflowDirForBootstrap(env: Record<string, string>): string {
  return resolveOverflowDir({ runId: "", wakePrompt: "", env });
}

export function resolveWakeCapBytesForBootstrap(env: Record<string, string>): number | null {
  return resolveCapBytes({ runId: "", wakePrompt: "", env });
}