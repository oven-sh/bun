import { afterAll, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { lstatSync, mkdirSync, realpath, realpathSync, rmSync, symlinkSync } from "fs";
import { isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

// fs.realpath's JS walk must never report a permission-denied component as a
// plain directory: a denied component can hide a junction, and the unresolved
// spelling would defeat realpath-based containment checks. The walk defers to
// the handle-based native resolution (true chain); if that also fails, the
// native error propagates.
//
// Setup: root/sub carries an INHERITED deny for the current user covering
// read-data (list) and read-attributes. lstat of root/sub/j then fails even
// through libuv's ACCESS_DENIED fallback (which recovers attributes by
// listing the parent — denied here), so the walk cannot see that j is a
// junction escaping to an out-of-root target. Traverse stays allowed, so the
// native resolution sees the true chain. A deny without inheritance would
// arm nothing: the fallback would list the undenied parent and the lstat
// would succeed — leaving the test a silent no-op.
//
// Elevated runners bypass deny ACEs; the precondition is probed and the
// tests skip visibly when it cannot hold.
let preconditionHolds = false;
let linkedFile = "";
let expected = "";
let denied = "";
let fixtureDir = "";

if (isWindows) {
  // Everything here must not throw: a module-scope failure exits the whole
  // file with code 1 instead of reporting a skip.
  try {
    const dir = tempDirWithFiles("realpath-denied", {
      "target/secret.txt": "out-of-root",
    });
    fixtureDir = dir;
    const root = join(dir, "root");
    const target = join(dir, "target");
    denied = join(root, "sub");
    mkdirSync(denied, { recursive: true });
    let junctionLive = false;
    try {
      // Sandboxed tokens get their junctions quarantined by the kernel (dead,
      // ELOOP on traversal); the scenario needs a live junction, so probe
      // through it and skip below where it is dead.
      symlinkSync(target, join(denied, "j"), "junction");
      lstatSync(join(denied, "j", "secret.txt"));
      junctionLive = true;
    } catch {}
    if (junctionLive) {
      linkedFile = join(denied, "j", "secret.txt");
      expected = realpathSync(join(target, "secret.txt"));

      execSync(`icacls "${denied}" /deny "%USERNAME%:(OI)(CI)(RA,RD,REA)"`, { shell: "cmd.exe" });
      try {
        lstatSync(join(denied, "j"));
        // Succeeded: the deny is bypassed (elevated) — skip below.
      } catch (e: any) {
        preconditionHolds = e.code === "EPERM" || e.code === "EACCES";
      }
    }
  } catch {
    preconditionHolds = false;
  }
}

afterAll(() => {
  if (!isWindows || !denied) return;
  try {
    execSync(`icacls "${denied}" /remove:d "%USERNAME%"`, { shell: "cmd.exe" });
  } catch {}
  try {
    rmSync(fixtureDir, { recursive: true, force: true });
  } catch {}
});

describe.skipIf(!isWindows)("realpath with a permission-denied component", () => {
  test.skipIf(!preconditionHolds)("realpathSync resolves the true chain through the denied component", () => {
    // The native resolution must succeed here (traverse is not denied), so
    // anything but the true out-of-root path — including the old fail-open
    // in-root spelling or a rethrown EPERM — is a regression.
    expect(realpathSync(linkedFile)).toBe(expected);
  });

  test.skipIf(!preconditionHolds)("callback realpath matches", async () => {
    const result = await new Promise<string>((resolve, reject) =>
      realpath(linkedFile, (err, p) => (err ? reject(err) : resolve(p as string))),
    );
    expect(result).toBe(expected);
  });

  test.skipIf(!preconditionHolds)(
    "realpathSync reports ENOENT when the tail behind the denied component is missing",
    () => {
      // Both resolutions fail here: the JS walk on the denied lstat, the native
      // one on the missing tail beyond the junction. The native verdict (ENOENT)
      // must propagate, not the walk's EPERM.
      let err: any;
      try {
        realpathSync(join(denied, "j", "does-not-exist.txt"));
      } catch (e) {
        err = e;
      }
      expect(err?.code).toBe("ENOENT");
    },
  );

  test.skipIf(!preconditionHolds)("callback realpath reports ENOENT for a missing tail", async () => {
    const err = await new Promise<any>(resolve => realpath(join(denied, "j", "does-not-exist.txt"), e => resolve(e)));
    expect(err?.code).toBe("ENOENT");
  });
});
