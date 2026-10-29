// Runtime enforcement lives in instrumentation.register, before any requests.
// Importing this module no longer bypasses validation or creates fake config.
export { validateRuntimeConfig, RuntimeConfigurationError } from "./runtime";
export type { RuntimeConfig } from "./runtime";
