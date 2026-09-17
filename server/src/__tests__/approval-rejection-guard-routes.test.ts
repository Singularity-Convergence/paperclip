import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApprovalService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  requestRevision: vi.fn(),
  resubmit: vi.fn(),
  listComments: vi.fn(),
  addComment: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  listIssuesForApproval: vi.fn(),
  linkManyForApproval: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeHireApprovalPayloadForPersistence: vi.fn(),
}));

const mockRejectionGuard = vi.hoisted(() => ({
  extractSinToken: vi.fn(),
  fingerprintFor: vi.fn(),
  lookupRecentRejections: vi.fn(),
  check: vi.fn(),
  isGuardDisabled: vi.fn(() => false),
  getWindowDays: vi.fn(() => 7),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    approvalService: () => mockApprovalService,
    heartbeatService: () => mockHeartbeatService,
    issueApprovalService: () => mockIssueApprovalService,
    rejectionGuardService: () => mockRejectionGuard,
    shouldEnforceRejectionGuard: (input: Record<string, unknown>) => {
      if (input.bypass) return false;
      if (input.requestedByUserId) return false;
      return true;
    },
    REJECTION_GUARD_BLOCK_MESSAGE: "Approval suppressed: SIN id was rejected within the guard window.",
    REJECTION_GUARD_BLOCK_REASON: "rejected_sin_guard",
    logActivity: mockLogActivity,
    secretService: () => mockSecretService,
  }));
}

async function createApp(actorOverrides: Record<string, unknown> = {}) {
  const [{ errorHandler }, { approvalRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/approvals.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "agent",
      agentId: "cerberus-agent",
      companyId: "company-1",
      companyIds: ["company-1"],
      source: "api_key",
      isInstanceAdmin: false,
      ...actorOverrides,
    };
    next();
  });
  app.use("/api", approvalRoutes({} as any));
  app.use(errorHandler);
  return app;
}

async function createUserApp() {
  const [{ errorHandler }, { approvalRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/approvals.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "user",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", approvalRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("approvals POST route — rejected-SIN guard hook (SIN-2096 P3)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/approvals.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockApprovalService.list.mockReset();
    mockApprovalService.getById.mockReset();
    mockApprovalService.create.mockReset();
    mockApprovalService.approve.mockReset();
    mockApprovalService.reject.mockReset();
    mockApprovalService.requestRevision.mockReset();
    mockApprovalService.resubmit.mockReset();
    mockApprovalService.listComments.mockReset();
    mockApprovalService.addComment.mockReset();
    mockHeartbeatService.wakeup.mockReset();
    mockIssueApprovalService.listIssuesForApproval.mockReset();
    mockIssueApprovalService.linkManyForApproval.mockReset();
    mockSecretService.normalizeHireApprovalPayloadForPersistence.mockReset();
    mockLogActivity.mockReset();
    mockRejectionGuard.extractSinToken.mockReset();
    mockRejectionGuard.fingerprintFor.mockReset();
    mockRejectionGuard.lookupRecentRejections.mockReset();
    mockRejectionGuard.check.mockReset();
    mockRejectionGuard.isGuardDisabled.mockReturnValue(false);
    mockHeartbeatService.wakeup.mockResolvedValue({ id: "wake-1" });
    mockIssueApprovalService.listIssuesForApproval.mockResolvedValue([{ id: "issue-1" }]);
    mockLogActivity.mockResolvedValue(undefined);
    mockSecretService.normalizeHireApprovalPayloadForPersistence.mockImplementation((_cid, payload) => payload);
  });

  function setupGuardVerdict(verdict: {
    matched: boolean;
    fingerprintSinId: string | null;
    matches: Array<{ approvalId: string; rejectedAt: Date; decidedByUserId: string | null }>;
  }) {
    mockRejectionGuard.check.mockResolvedValue(verdict);
  }

  it("suppresses the create request with 422 when the guard reports a fingerprint match", async () => {
    setupGuardVerdict({
      matched: true,
      fingerprintSinId: "SIN-1794",
      matches: [
        {
          approvalId: "773a7767-original-rejection",
          rejectedAt: new Date("2026-09-16T15:59:58.000Z"),
          decidedByUserId: "chairman-1",
        },
      ],
    });
    const res = await request(await createApp())
      .post("/api/companies/company-1/approvals")
      .send({
        type: "request_board_approval",
        payload: {
          title: "CEO Review: SIN-1794 Plan Approval Monitor promotion to production vault",
        },
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      reason: "rejected_sin_guard",
      fingerprintSinId: "SIN-1794",
      rejectedApprovalId: "773a7767-original-rejection",
    });
    expect(res.body.error).toMatch(/rejected within the guard window/i);
    expect(mockApprovalService.create).not.toHaveBeenCalled();
    expect(mockIssueApprovalService.linkManyForApproval).not.toHaveBeenCalled();
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "approval.guard_suppressed",
        entityId: "773a7767-original-rejection",
        details: expect.objectContaining({
          fingerprintSinId: "SIN-1794",
          reason: "rejected_sin_guard",
        }),
      }),
    );
  });

  it("creates the approval when the guard finds no matching fingerprint", async () => {
    setupGuardVerdict({
      matched: false,
      fingerprintSinId: "SIN-1000",
      matches: [],
    });
    mockApprovalService.create.mockResolvedValue({
      id: "approval-fresh",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: { title: "Promote SIN-1000 vault" },
    });
    const res = await request(await createApp())
      .post("/api/companies/company-1/approvals")
      .send({
        type: "request_board_approval",
        payload: { title: "Promote SIN-1000 vault" },
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body).toMatchObject({ id: "approval-fresh" });
    expect(mockApprovalService.create).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "approval.created" }),
    );
  });

  it("never calls svc.create when the guard short-circuits (FR-3 / FR-4 sanity)", async () => {
    setupGuardVerdict({
      matched: true,
      fingerprintSinId: "SIN-100",
      matches: [
        {
          approvalId: "rej-sin-100",
          rejectedAt: new Date("2026-09-16T16:00:00.000Z"),
          decidedByUserId: "chairman-1",
        },
      ],
    });
    const res = await request(await createApp())
      .post("/api/companies/company-1/approvals")
      .send({
        type: "request_board_approval",
        payload: {
          title: "CEO Review: SIN-100 vault promotion",
          summary: "different body but same SIN id",
        },
      });

    expect(res.status).toBe(422);
    expect(mockApprovalService.create).not.toHaveBeenCalled();
  });

  it("FR-5 — user-initiated request bypasses the guard and creates the approval", async () => {
    // No mockRejectionGuard.check call expected — shouldEnforceRejectionGuard
    // returns false for user-initiated requests, so the guard is never invoked.
    mockApprovalService.create.mockResolvedValue({
      id: "approval-user",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: { title: "Promote SIN-1794 vault (user override)" },
      requestedByUserId: "user-1",
      requestedByAgentId: null,
    });
    const res = await request(await createUserApp())
      .post("/api/companies/company-1/approvals")
      .send({
        type: "request_board_approval",
        payload: { title: "Promote SIN-1794 vault (user override)" },
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body).toMatchObject({
      id: "approval-user",
      requestedByUserId: "user-1",
      requestedByAgentId: null,
    });
    expect(mockRejectionGuard.check).not.toHaveBeenCalled();
    expect(mockApprovalService.create).toHaveBeenCalledTimes(1);
  });

  it("rejection-history endpoint returns the same-company matches", async () => {
    const rejectionTime = new Date("2026-09-16T15:59:58.000Z");
    mockRejectionGuard.extractSinToken.mockReturnValue("SIN-1794");
    mockRejectionGuard.lookupRecentRejections.mockResolvedValue([
      {
        approvalId: "773a7767-original",
        rejectedAt: rejectionTime,
        decidedByUserId: "chairman-1",
        sinId: "SIN-1794",
      },
    ]);
    const res = await request(await createApp())
      .get("/api/companies/company-1/approvals/rejection-history?sinId=SIN-1794");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fingerprintSinId: "SIN-1794",
      matches: [
        expect.objectContaining({
          approvalId: "773a7767-original",
          decidedByUserId: "chairman-1",
        }),
      ],
    });
    expect(mockRejectionGuard.lookupRecentRejections).toHaveBeenCalledWith("company-1", "SIN-1794");
  });

  it("rejection-history endpoint returns 400 when sinId is missing", async () => {
    const res = await request(await createApp()).get(
      "/api/companies/company-1/approvals/rejection-history",
    );
    expect(res.status).toBe(400);
  });
});
