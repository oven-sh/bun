import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync } from "fs";
import { bunEnv, isWindows, tempDir } from "harness";
import { join } from "path";

// Tests for the curl | bash installer (src/runtime/cli/install.sh), not the
// package manager. The script picks a release target from `uname -ms` plus a
// libc probe, then downloads bun-<target>.zip from $GITHUB. We stub uname and
// ldd on PATH, point $GITHUB at a local server, and assert which target the
// script asks for.

const installSh = join(import.meta.dir, "../../src/runtime/cli/install.sh");

// On a real musl host the script detects musl from the filesystem, so the
// glibc expectation below cannot hold there.
function hostLooksMusl(): boolean {
  if (existsSync("/etc/alpine-release")) return true;
  try {
    for (const _ of new Bun.Glob("ld-musl-*.so.1").scanSync("/lib")) return true;
  } catch {}
  return false;
}

async function requestedReleasePath(lddStub: string): Promise<string | undefined> {
  let requested: string | undefined;
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      requested = new URL(req.url).pathname;
      return new Response("not a real zip");
    },
  });

  using dir = tempDir("install-sh", {
    "bin/uname": `#!/bin/sh\necho "Linux aarch64"\n`,
    "bin/ldd": lddStub,
    "bin/unzip": `#!/bin/sh\nexit 0\n`,
    "install/.keep": "",
  });
  for (const stub of ["uname", "ldd", "unzip"]) {
    chmodSync(join(String(dir), "bin", stub), 0o755);
  }

  await using proc = Bun.spawn({
    cmd: ["bash", installSh],
    env: {
      ...bunEnv,
      PATH: `${join(String(dir), "bin")}:${bunEnv.PATH}`,
      BUN_INSTALL: join(String(dir), "install"),
      GITHUB: `http://localhost:${server.port}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  // The stub unzip extracts nothing, so the script fails after the download.
  // The download request is all this test needs.
  await proc.exited;
  return requested;
}

describe.skipIf(isWindows)("install.sh target detection", () => {
  // musl's ldd prints its banner to stderr and exits non-zero.
  test.concurrent("selects the musl build when ldd reports musl", async () => {
    const path = await requestedReleasePath(`#!/bin/sh\nprintf 'musl libc (aarch64)\\nVersion 1.2.5\\n' >&2\nexit 1\n`);
    expect(path).toBe("/oven-sh/bun/releases/latest/download/bun-linux-aarch64-musl.zip");
  });

  test.concurrent.skipIf(hostLooksMusl())("selects the glibc build when ldd reports glibc", async () => {
    const path = await requestedReleasePath(`#!/bin/sh\necho "ldd (GNU libc) 2.39"\n`);
    expect(path).toBe("/oven-sh/bun/releases/latest/download/bun-linux-aarch64.zip");
  });
});
