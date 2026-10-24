export const remoteDefaults = { url: "", retries: 0 };
export type Remote = typeof remoteDefaults;
const remoteShapes = ["round", "flat"] as const;
export type RemoteShape = (typeof remoteShapes)[number];
export enum RemoteKind { Fast = "fast", Slow = "slow" }
