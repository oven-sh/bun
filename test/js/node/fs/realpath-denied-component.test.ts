import { afterAll, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { lstatSync, mkdirSync, realpath, realpathSync, rmSync, symlinkSync } from "fs";
import { isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

// Outside an AppContainer, fs.realpath keeps Node's exact behavior: the JS
// walk's EPERM on a denied component propagates unchanged (no deferral to the
// native resolver). This pins that parity; the in-container fallback is
// covered by the AppContainer suite's realpath probe. Intentionally passes on
// system bun — it guards preserved behavior against the gate regressing.
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

      execSync(`icacls "${denied}" /deny "%USERNAME%:(OI)(CI)(RA,RD,REA)"`, { shell: "cmd.exe" });
      try {
        lstatSync(join(denied, "j"));
        // Succeeded: the deny is bypassed (elevated) — skip below.
      } catch (e: any) {
        // libuv maps ERROR_ACCESS_DENIED to EPERM; the assertions pin that.
        preconditionHolds = e.code === "EPERM";
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

describe.skipIf(!isWindows)("realpath with a permission-denied component (outside AppContainer)", () => {
  test.skipIf(!preconditionHolds)("realpathSync throws the walk's EPERM at the denied component", () => {
    // Neither fail-open (in-root spelling) nor resolution through the hidden
    // junction is acceptable outside a container: both would return instead
    // of throwing, and any other code breaks Node parity.
    let err: any;
    try {
      realpathSync(linkedFile);
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("EPERM");
  });

  test.skipIf(!preconditionHolds)("callback realpath reports the same EPERM", async () => {
    const err = await new Promise<any>(resolve => realpath(linkedFile, e => resolve(e)));
    expect(err?.code).toBe("EPERM");
  });

  test.skipIf(!preconditionHolds)("realpathSync throws EPERM even when the tail is missing", () => {
    // The walk stops at the denied component before any tail resolution, so
    // the missing tail never turns this into ENOENT outside a container.
    let err: any;
    try {
      realpathSync(join(denied, "j", "does-not-exist.txt"));
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("EPERM");
  });

  test.skipIf(!preconditionHolds)("callback realpath throws EPERM for a missing tail", async () => {
    const err = await new Promise<any>(resolve => realpath(join(denied, "j", "does-not-exist.txt"), e => resolve(e)));
    expect(err?.code).toBe("EPERM");
  });
});
