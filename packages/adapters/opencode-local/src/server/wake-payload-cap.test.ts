import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyWakeCommentMaxBytesCap,
  DEFAULT_PAPERCLIP_WAKE_COMMENT_MAX_BYTES,
  DEFAULT_PAPERCLIP_WAKE_OVERFLOW_DIR,
  resolveWakeCapBytesForBootstrap,
  resolveWakeOverflowDirForBootstrap,
} from "./wake-payload-cap.js";

describe("applyWakeCommentMaxBytesCap", () => {
  const fixedNow = new Date("2026-09-29T11:25:00.000Z");
  let overflowDir: string;
  let written: Array<{ filePath: string; body: string }>;

  beforeEach(async () => {
    overflowDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-wake-overflow-"));
    written = [];
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(overflowDir, { recursive: true, force: true });
  });

  it("returns the wake prompt unchanged when under the cap", async () => {
    const result = await applyWakeCommentMaxBytesCap({
      runId: "run-under",
      wakePrompt: "hello world",
      env: {},
      now: () => fixedNow,
      fileWriter: (...args) => {
        written.push({ filePath: args[0], body: args[1] });
        return Promise.resolve();
      },
    });
    expect(result.truncated).toBe(false);
    expect(result.reason).toBe("under_cap");
    expect(result.originalBytes).toBe("hello world".length);
    expect(result.cappedBytes).toBe("hello world".length);
    expect(result.capBytes).toBe(DEFAULT_PAPERCLIP_WAKE_COMMENT_MAX_BYTES);
    expect(result.overflowFilePath).toBeNull();
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.wakePrompt).toBe("hello world");
    expect(written).toHaveLength(0);
  });

  it("treats bytes-equal-to-cap as under_cap", async () => {
    const cap = 16;
    const wakePrompt = "x".repeat(cap);
    const result = await applyWakeCommentMaxBytesCap({
      runId: "run-at-cap",
      wakePrompt,
      env: { PAPERCLIP_WAKE_COMMENT_MAX_BYTES: String(cap) },
      now: () => fixedNow,
      fileWriter: (...args) => {
        written.push({ filePath: args[0], body: args[1] });
        return Promise.resolve();
      },
    });
    expect(result.reason).toBe("at_cap");
    expect(result.truncated).toBe(false);
    expect(result.originalBytes).toBe(cap);
    expect(result.cappedBytes).toBe(cap);
    expect(result.capBytes).toBe(cap);
    expect(written).toHaveLength(0);
  });

  it("writes overflow file and returns a stub when over the cap", async () => {
    const cap = 1024;
    const overlong = "A".repeat(cap + 1);
    const result = await applyWakeCommentMaxBytesCap({
      runId: "run-over",
      wakePrompt: overlong,
      env: {
        PAPERCLIP_WAKE_COMMENT_MAX_BYTES: String(cap),
        PAPERCLIP_WAKE_OVERFLOW_DIR: overflowDir,
      },
      now: () => fixedNow,
      fileWriter: (...args) => {
        written.push({ filePath: args[0], body: args[1] });
        return Promise.resolve();
      },
    });
    expect(result.truncated).toBe(true);
    expect(result.reason).toBe("over_cap");
    expect(result.originalBytes).toBe(cap + 1);
    expect(result.capBytes).toBe(cap);
    expect(result.overflowFilePath).toBe(path.join(overflowDir, `run-over-${fixedNow.toISOString().replace(/[:.]/g, "-")}.md`));
    expect(result.cappedBytes).toBeLessThan(cap);
    expect(result.cappedBytes).toBeGreaterThan(0);
    expect(result.wakePrompt).toContain("[Paperclip wake payload truncated]");
    expect(result.wakePrompt).toContain(result.overflowFilePath);
    expect(result.wakePrompt).toContain(`sha256=${result.sha256}`);
    expect(written).toHaveLength(1);
    expect(written[0].filePath).toBe(result.overflowFilePath);
    expect(written[0].body).toBe(overlong);
  });

  it("honors PAPERCLIP_WAKE_COMMENT_MAX_BYTES env override", async () => {
    const cap = 8;
    const result = await applyWakeCommentMaxBytesCap({
      runId: "run-env-override",
      wakePrompt: "123456789",
      env: { PAPERCLIP_WAKE_COMMENT_MAX_BYTES: String(cap) },
      now: () => fixedNow,
      fileWriter: (...args) => {
        written.push({ filePath: args[0], body: args[1] });
        return Promise.resolve();
      },
    });
    expect(result.capBytes).toBe(cap);
    expect(result.truncated).toBe(true);
    expect(result.reason).toBe("over_cap");
  });

  it("falls back to default overflow dir when env override is unset", async () => {
    const result = await applyWakeCommentMaxBytesCap({
      runId: "run-default-dir",
      wakePrompt: "x".repeat(64),
      env: { PAPERCLIP_WAKE_COMMENT_MAX_BYTES: "16" },
      now: () => fixedNow,
    });
    expect(result.overflowFilePath).toContain(DEFAULT_PAPERCLIP_WAKE_OVERFLOW_DIR);
  });

  it("reports overflow_dir_unwritable when the writer throws", async () => {
    const result = await applyWakeCommentMaxBytesCap({
      runId: "run-unwritable",
      wakePrompt: "y".repeat(64),
      env: { PAPERCLIP_WAKE_COMMENT_MAX_BYTES: "16" },
      now: () => fixedNow,
      fileWriter: () => Promise.reject(new Error("EACCES")),
    });
    expect(result.reason).toBe("overflow_dir_unwritable");
    expect(result.truncated).toBe(false);
    expect(result.overflowFilePath).toBeNull();
    expect(result.wakePrompt).toBe("y".repeat(64));
  });

  it("treats PAPERCLIP_WAKE_COMMENT_MAX_BYTES=0 as cap disabled", async () => {
    const overlong = "z".repeat(1024);
    const result = await applyWakeCommentMaxBytesCap({
      runId: "run-cap-disabled",
      wakePrompt: overlong,
      env: { PAPERCLIP_WAKE_COMMENT_MAX_BYTES: "0" },
      now: () => fixedNow,
    });
    expect(result.reason).toBe("cap_disabled");
    expect(result.truncated).toBe(false);
    expect(result.originalBytes).toBe(1024);
    expect(result.wakePrompt).toBe(overlong);
  });

  it("uses the process env when run env is unset", async () => {
    vi.stubEnv("PAPERCLIP_WAKE_COMMENT_MAX_BYTES", "16");
    const result = await applyWakeCommentMaxBytesCap({
      runId: "run-process-env",
      wakePrompt: "x".repeat(64),
      env: {},
      now: () => fixedNow,
    });
    expect(result.capBytes).toBe(16);
    expect(result.truncated).toBe(true);
  });

  it("computes multi-byte UTF-8 byte length, not character length", async () => {
    const cap = 10;
    const multiByte = "\u{1F600}".repeat(4);
    const byteLength = Buffer.byteLength(multiByte, "utf8");
    const result = await applyWakeCommentMaxBytesCap({
      runId: "run-multibyte",
      wakePrompt: multiByte,
      env: { PAPERCLIP_WAKE_COMMENT_MAX_BYTES: String(cap) },
      now: () => fixedNow,
      fileWriter: (...args) => {
        written.push({ filePath: args[0], body: args[1] });
        return Promise.resolve();
      },
    });
    expect(result.originalBytes).toBe(byteLength);
    expect(byteLength).toBeGreaterThan(cap);
    expect(result.truncated).toBe(true);
  });

  it("sanitizes the runId before composing the overflow file name", async () => {
    const result = await applyWakeCommentMaxBytesCap({
      runId: "../../etc/passwd-run??",
      wakePrompt: "x".repeat(64),
      env: {
        PAPERCLIP_WAKE_COMMENT_MAX_BYTES: "16",
        PAPERCLIP_WAKE_OVERFLOW_DIR: overflowDir,
      },
      now: () => fixedNow,
    });
    expect(result.overflowFilePath).not.toBeNull();
    expect(result.overflowFilePath!.includes("..")).toBe(false);
    expect(result.overflowFilePath!.includes("?")).toBe(false);
    expect(result.overflowFilePath!.startsWith(overflowDir)).toBe(true);
  });
});

describe("resolveWakeCapBytesForBootstrap / resolveWakeOverflowDirForBootstrap", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the default cap from the env object", () => {
    expect(resolveWakeCapBytesForBootstrap({})).toBe(DEFAULT_PAPERCLIP_WAKE_COMMENT_MAX_BYTES);
  });

  it("honors PAPERCLIP_WAKE_COMMENT_MAX_BYTES=0 as disabled", () => {
    expect(resolveWakeCapBytesForBootstrap({ PAPERCLIP_WAKE_COMMENT_MAX_BYTES: "0" })).toBeNull();
  });

  it("returns the default overflow dir from the env object", () => {
    expect(resolveWakeOverflowDirForBootstrap({})).toBe(DEFAULT_PAPERCLIP_WAKE_OVERFLOW_DIR);
  });

  it("honors PAPERCLIP_WAKE_OVERFLOW_DIR override", () => {
    expect(
      resolveWakeOverflowDirForBootstrap({ PAPERCLIP_WAKE_OVERFLOW_DIR: "/tmp/custom" }),
    ).toBe("/tmp/custom");
  });
});