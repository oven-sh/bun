import { normalizeBunSnapshot as normalizeBunSnapshotBase } from "./harness";

/**
 * Normalize Bun snapshot output for patch-related tests
 * Removes package resolution messages and normalizes fstatat() to stat()
 */
export const normalizeBunSnapshotForPatch = (str: string) => {
  str = normalizeBunSnapshotBase(str);
  str = str.replace(/.*Resolved, downloaded and extracted.*\n?/g, "");
  str = str.replaceAll("fstatat()", "stat()");
  return str;
};