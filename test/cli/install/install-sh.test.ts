import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tmpdirSync } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { makeZipStored, restrictedPathDir } from "./fake-release";

const installScript = join(import.meta.dir, "../../../src/runtime/cli/install.sh");

// Everything install.sh runs besides the download and extract programs.
const baseTools = ["bash", "uname", "mkdir", "mv", "chmod", "rm", "basename", "grep", "cat", "sysctl"];

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
  const home = tmpdirSync("bun-install-sh-home");
  const installDir = join(home, ".bun");
  await using proc = Bun.spawn({
    cmd: ["bash", installScript],
    env: {
      ...bunEnv,
      PATH: pathDir,
      HOME: home,
      SHELL: "/bin/sh",
      BUN_INSTALL: installDir,
      GITHUB: `http://${server.hostname}:${server.port}`,
    },
    cwd: home,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, exe: join(installDir, "bin", "bun") };
}

describe.skipIf(isWindows).concurrent("install.sh", () => {
  const wgetPath = restrictedPathDir([...baseTools, "wget", "unzip"], ["wget", "unzip"]);
  test.skipIf(!wgetPath)("downloads with wget when curl is missing", async () => {
    const { stdout, stderr, exitCode, exe } = await runInstaller(wgetPath!);
    expect(stderr).not.toContain("error");
    expect(stdout).toContain("bun was installed successfully");
    expect(statSync(exe).mode & 0o111).not.toBe(0);
    expect(exitCode).toBe(0);
  });

  const python3Path = restrictedPathDir([...baseTools, "curl", "python3"], ["curl", "python3"]);
  test.skipIf(!python3Path)("extracts with python3 when unzip is missing", async () => {
    const { stdout, stderr, exitCode, exe } = await runInstaller(python3Path!);
    expect(stderr).not.toContain("error");
    expect(stdout).toContain("bun was installed successfully");
    expect(statSync(exe).mode & 0o111).not.toBe(0);
    expect(exitCode).toBe(0);
  });

  const noDownloaderPath = restrictedPathDir([...baseTools, "unzip"], ["unzip"]);
  test.skipIf(!noDownloaderPath)("reports when neither curl nor wget exists", async () => {
    const { stderr, exitCode } = await runInstaller(noDownloaderPath!);
    expect(stderr).toContain("curl or wget is required to install bun");
    expect(exitCode).toBe(1);
  });

  const noExtractorPath = restrictedPathDir([...baseTools, "curl"], ["curl"]);
  test.skipIf(!noExtractorPath)("reports when no archive extractor exists", async () => {
    const { stderr, exitCode } = await runInstaller(noExtractorPath!);
    expect(stderr).toContain("unzip is required to install bun (7z, busybox, bsdtar, python3 supported)");
    expect(exitCode).toBe(1);
  });
});
