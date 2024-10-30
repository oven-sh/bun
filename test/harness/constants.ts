export const isMacOS = process.platform === "darwin";
export const isWindows = process.platform === "win32";
export const isLinux = process.platform === "linux";
export const isUnix = isMacOS || isLinux;
export const isBuildkite = process.env.BUILDKITE === "true";
export const isGithubAction = process.env.GITHUB_ACTIONS === "true";
export const isCI = process.env.CI === "true" || isBuildkite || isGithubAction;
export const isDebug = process.env.DEBUG === "1";
