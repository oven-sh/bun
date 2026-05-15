// Regression coverage for #30860: install.sh must route FreeBSD and
// Termux hosts to the correct prebuilt zip. `uname -ms` doesn't
// distinguish Termux from a regular Linux host, so we need the
// TERMUX_VERSION/$PREFIX probe to kick in.
//
// Strategy: shim `uname`, `unzip`, and `curl` in a tempdir. The curl
// shim prints the URL it was called with and exits non-zero, which
// stops install.sh at the download step before any network I/O. Grep
// the URL out of stdout/stderr to confirm the right target was picked.

import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";

const installSh = readFileSync(join(import.meta.dir, "..", "..", "src", "runtime", "cli", "install.sh"), "utf8");

async function resolveZip(opts: { uname: string; termux?: boolean }): Promise<string> {
  using dir = tempDir("install-sh-30860", {
    "bin": {
      "uname": `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(opts.uname)}\n`,
      "unzip": `#!/bin/sh\nexit 0\n`,
      "curl": `#!/bin/sh\nfor arg in "$@"; do case "$arg" in https://*) printf 'CURLED: %s\\n' "$arg";; esac; done\nexit 42\n`,
    },
    "install.sh": installSh,
  });
  const shimDir = join(String(dir), "bin");
  for (const name of ["uname", "unzip", "curl"]) {
    chmodSync(join(shimDir, name), 0o755);
  }
  const env: Record<string, string> = {
    PATH: `${shimDir}:/usr/bin:/bin`,
    HOME: String(dir),
    TERM: "dumb",
  };
  if (opts.termux) {
    env.TERMUX_VERSION = "0.118.0";
    env.PREFIX = "/data/data/com.termux/files/usr";
  }
  await using proc = Bun.spawn({
    cmd: ["bash", join(String(dir), "install.sh")],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  await proc.exited;
  return (stdout + stderr).match(/CURLED:\s+(\S+)/)?.[1] ?? "";
}

test.skipIf(isWindows)("#30860: install.sh picks freebsd-x64 on FreeBSD amd64", async () => {
  // uname -ms reports 'FreeBSD amd64' on x86_64 FreeBSD (not 'FreeBSD x86_64').
  expect(await resolveZip({ uname: "FreeBSD amd64" })).toContain("bun-freebsd-x64");
});

test.skipIf(isWindows)("#30860: install.sh picks linux-aarch64-android under Termux", async () => {
  // Termux's uname -ms looks like a regular Linux host; the TERMUX_VERSION
  // env var (set by the Termux app) is the signal that routes us to the
  // bionic Android build instead of glibc linux-aarch64.
  expect(await resolveZip({ uname: "Linux aarch64", termux: true })).toContain("bun-linux-aarch64-android");
});
