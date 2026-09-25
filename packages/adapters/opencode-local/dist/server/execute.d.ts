import { type AdapterExecutionContext, type AdapterExecutionResult } from "@paperclipai/adapter-utils";
export declare function ensureRemoteOpenCodeModelConfiguredAndAvailable(input: {
    runId: string;
    executionTarget: NonNullable<AdapterExecutionContext["executionTarget"]>;
    command: string;
    model: string;
    cwd: string;
    env: Record<string, string>;
    timeoutSec: number;
    graceSec: number;
}): Promise<void>;
export declare function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult>;
//# sourceMappingURL=execute.d.ts.map