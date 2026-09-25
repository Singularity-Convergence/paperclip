import type { AdapterSkillContext, AdapterSkillSnapshot } from "@paperclipai/adapter-utils";
export declare function resolveOpenCodeSkillsHome(config: Record<string, unknown>): string;
export declare function listOpenCodeSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot>;
export declare function syncOpenCodeSkills(ctx: AdapterSkillContext, desiredSkills: string[]): Promise<AdapterSkillSnapshot>;
export declare function resolveOpenCodeDesiredSkillNames(config: Record<string, unknown>, availableEntries: Array<{
    key: string;
}>): string[];
//# sourceMappingURL=skills.d.ts.map