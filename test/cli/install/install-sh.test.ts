import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { makeZipStored, restrictedPathDir, type RestrictedPath } from "./fake-release";

const installScript = join(import.meta.dir, "../../../src/runtime/cli/install.sh");

// Everything install.sh runs besides the download and extract programs.
const baseTools = ["bash", "uname", "mkdir", "mv", "chmod", "rm", "basename", "grep", "cat", "sysctl"];

// Every extractor install.sh probes, with a command that proves the one on
// this host works under the restricted PATH.
const extractors: Record<string, string[] | undefined> = {
  unzip: undefined,
  busybox: ["/bin/sh", "-c", "busybox --list | grep -x unzip"],
  "7z": undefined,
  "7zz": undefined,
  "7za": undefined,
  bsdtar: undefined,
  python3: ["python3", "-m", "zipfile", "-h"],
};

const pathDirs: RestrictedPath[] = [];
function pathWith(programs: string[], probe?: string[]): RestrictedPath | null {
  const dir = restrictedPathDir([...baseTools, ...programs], programs, probe);
  if (dir) pathDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of pathDirs) dir[Symbol.dispose]();
});

// Serves any `bun-<target>.zip` the installer asks for, with a shell script in
// place of the binary. The folder name inside the zip must match the target
// the installer computed, so it is taken from the request.
function startReleaseServer() {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const match = /\/(bun-[^/]+)\.zip$/.exec(new URL(req.url).pathname);
      if (!match) return new Response("not found", { status: 404 });
      const script = Buffer.from("#!/bin/sh\necho fake-bun\n");
      return new Response(makeZipStored(`${match[1]}/bun`, script, 0o644), {
        headers: { "Content-Type": "application/zip" },
      });
    },
  });
}

async function runInstaller(pathDir: string) {
  using server = startReleaseServer();
  using home = tempDir("bun-install-sh-home", {});
  const installDir = join(home, ".bun");
  await using proc = Bun.spawn({
    cmd: ["bash", installScript],
    env: {
      ...bunEnv,
      PATH: pathDir,
      HOME: String(home),
      SHELL: "/bin/sh",
      BUN_INSTALL: installDir,
      GITHUB: `http://${server.hostname}:${server.port}`,
    },
    cwd: String(home),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const exe = join(installDir, "bin", "bun");
  const executable = exitCode === 0 && (statSync(exe).mode & 0o111) !== 0;
  return { stdout, stderr, exitCode, executable };
}

describe.concurrent("install.sh", () => {
  const wgetPath = pathWith(["wget", "unzip"]);
  test.skipIf(!wgetPath)("downloads with wget when curl is missing", async () => {
    const { stdout, stderr, exitCode, executable } = await runInstaller(wgetPath!);
    expect(stderr).not.toContain("error");
    expect(stdout).toContain("bun was installed successfully");
    expect(executable).toBe(true);
    expect(exitCode).toBe(0);
  });

  for (const [name, probe] of Object.entries(extractors)) {
    const extractorPath = pathWith(["curl", name], probe);
    test.skipIf(!extractorPath)(`extracts with ${name} when it is the only extractor`, async () => {
      const { stdout, stderr, exitCode, executable } = await runInstaller(extractorPath!);
      expect(stderr).not.toContain("error");
      expect(stdout).toContain("bun was installed successfully");
      expect(executable).toBe(true);
      expect(exitCode).toBe(0);
    });
  }

  const noDownloaderPath = pathWith(["unzip"]);
  test.skipIf(!noDownloaderPath)("reports when neither curl nor wget exists", async () => {
    const { stderr, exitCode } = await runInstaller(noDownloaderPath!);
    expect(stderr).toContain("curl or wget is required to install bun");
    expect(exitCode).toBe(1);
  });

  const noExtractorPath = pathWith(["curl"]);
  test.skipIf(!noExtractorPath)("reports when no archive extractor exists", async () => {
    const { stderr, exitCode } = await runInstaller(noExtractorPath!);
    expect(stderr).toContain("unzip is required to install bun (7z, busybox, bsdtar, python3 supported)");
    expect(exitCode).toBe(1);
  });
});
