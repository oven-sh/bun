import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isWindows, tempDirWithFiles } from "harness";
import { realpathSync, realpath, lstatSync, mkdirSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

// fs.realpath's JS walk must never report a permission-denied component as a
// plain directory: a denied component can hide a junction, and the unresolved
// spelling would defeat realpath-based containment checks. The walk defers to
// the handle-based native resolution (true chain) and rethrows the original
// error if that also fails.
//
// Setup: root/sub is deny-ACL'd for the current user (lstat fails EPERM) but
// stays traversable, and root/sub/j is a junction escaping to an out-of-root
// target. Elevated runners bypass deny ACEs (SeBackupPrivilege), so the test
// skips itself when the precondition does not hold.
describe.skipIf(!isWindows)("realpath with a permission-denied component", () => {
  let root: string, target: string, linkedFile: string, expected: string;
  let preconditionHolds = false;

  beforeAll(() => {
    const dir = tempDirWithFiles("realpath-denied", {
      "target/secret.txt": "out-of-root",
    });
    root = join(dir, "root");
    target = join(dir, "target");
    mkdirSync(join(root, "sub"), { recursive: true });
    // A junction needs no privilege; symlinkSync(type "junction") uses one.
    symlinkSync(target, join(root, "sub", "j"), "junction");
    linkedFile = join(root, "sub", "j", "secret.txt");
    expected = realpathSync(join(target, "secret.txt"));

    execSync(`icacls "${join(root, "sub")}" /deny "%USERNAME%:(RA,RD,REA)"`, { shell: "cmd.exe" });
    try {
      lstatSync(join(root, "sub"));
      // lstat succeeded: deny ACE ineffective (elevated runner) — skip below.
    } catch (e: any) {
      preconditionHolds = e.code === "EPERM" || e.code === "EACCES";
    }
  });

  afterAll(() => {
    try {
      execSync(`icacls "${join(root, "sub")}" /remove:d "%USERNAME%"`, { shell: "cmd.exe" });
    } catch {}
  });

  test("realpathSync resolves the true chain through the denied component", () => {
    if (!preconditionHolds) return; // elevated: deny ACE bypassed
    // Fail-closed: either the true (out-of-root) resolution, or a rethrown
    // permission error — never the unresolved in-root spelling.
    let result: string | undefined;
    try {
      result = realpathSync(linkedFile);
    } catch (e: any) {
      expect(["EPERM", "EACCES"]).toContain(e.code);
      return;
    }
    expect(result).toBe(expected);
  });

  test("callback realpath matches", async () => {
    if (!preconditionHolds) return;
    const result = await new Promise<string>((resolve, reject) =>
      realpath(linkedFile, (err, p) => (err ? reject(err) : resolve(p as string))),
    ).catch((e: any) => {
      expect(["EPERM", "EACCES"]).toContain(e.code);
      return undefined;
    });
    if (result !== undefined) expect(result).toBe(expected);
  });
});
