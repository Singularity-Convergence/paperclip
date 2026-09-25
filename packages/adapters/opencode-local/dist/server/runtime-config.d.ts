type PreparedOpenCodeRuntimeConfig = {
    env: Record<string, string>;
    notes: string[];
    cleanup: () => Promise<void>;
};
export declare function prepareOpenCodeRuntimeConfig(input: {
    env: Record<string, string>;
    config: Record<string, unknown>;
    targetIsRemote?: boolean;
}): Promise<PreparedOpenCodeRuntimeConfig>;
/** Managed credentials must never leave host-only homes in a remote process. */
export declare function prepareManagedOpenCodeRemoteHomes(input: {
    env: Record<string, string>;
    config: Record<string, unknown>;
    runtimeRootDir: string | null | undefined;
    runId: string;
    configDir?: string;
}): void;
export {};
//# sourceMappingURL=runtime-config.d.ts.map