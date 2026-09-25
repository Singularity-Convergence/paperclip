import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";
export declare const sessionCodec: AdapterSessionCodec;
export { execute } from "./execute.js";
export { listOpenCodeSkills, syncOpenCodeSkills } from "./skills.js";
export { testEnvironment } from "./test.js";
export { listOpenCodeModels, discoverOpenCodeModels, ensureOpenCodeModelConfiguredAndAvailable, requireOpenCodeModelId, resetOpenCodeModelsCacheForTests, } from "./models.js";
export { parseOpenCodeJsonl, isOpenCodeUnknownSessionError } from "./parse.js";
//# sourceMappingURL=index.d.ts.map