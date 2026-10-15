import { afterAll, describe, expect, test } from "bun:test";
import { isLinux, isMacOS, isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeZipStored, restrictedPathDir } from "./fake-release";

// The shell config step of install.sh: which startup file gets the `# bun`
// block, and that a second run does not append it again. A local server
// stands in for GitHub (the script reads `$GITHUB`), so no test contacts the
// network. The "bun" in the served zip is a shell script: the installer only
// runs `bun completions` and ignores its result.

const installScript = join(import.meta.dir, "../../../src/runtime/cli/install.sh");

// `bun` stays off this PATH on purpose: the installer skips the shell config
// step when `bun` is already found. `id` is for /etc/profile in login shells.
const tools = [
  "bash",
  "curl",
  "unzip",
  "uname",
  "mkdir",
  "mv",
  "chmod",
  "rm",
  "basename",
  "grep",
  "cat",
  "sysctl",
  "id",
];
const pathDir = isWindows ? null : restrictedPathDir(tools, ["bash", "curl", "unzip"]);
afterAll(() => pathDir?.[Symbol.dispose]());

function startReleaseServer() {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const match = /\/(bun-[^/]+)\.zip$/.exec(new URL(req.url).pathname);
      if (!match) return new Response("not found", { status: 404 });
      const script = Buffer.from("#!/bin/sh\nexit 0\n");
      return new Response(makeZipStored(`${match[1]}/bun`, script, 0o755), {
        headers: { "Content-Type": "application/zip" },
      });
    },
  });
}

function shellEnv(home: string, shell: string, github = "") {
  return { HOME: home, USER: "bun-test", TERM: "xterm", PATH: String(pathDir), SHELL: shell, GITHUB: github };
}

async function runInstaller(home: string, shell: string) {
  using server = startReleaseServer();
  await using proc = Bun.spawn({
    cmd: ["bash", installScript],
    env: shellEnv(home, shell, server.url.origin),
    cwd: home,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Starts bash the way a terminal does (`-ic`: interactive non-login, as a
// Linux terminal; `-lic`: interactive login, as a macOS terminal) and reports
// which `bun` it finds.
async function bunOnPath(home: string, flags: "-ic" | "-lic") {
  await using proc = Bun.spawn({
    cmd: ["bash", flags, "command -v bun || echo none"],
    env: shellEnv(home, "/bin/bash"),
    cwd: home,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
  return stdout.trim();
}

function countBunBlocks(path: string) {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(line => line === "# bun").length;
}

const bashHome = {
  ".bash_profile": "if [ -f ~/.bashrc ]; then\n    . ~/.bashrc\nfi\n",
  ".bashrc": 'PS1="$ "\n',
};

describe.concurrent("install.sh shell config", () => {
  test.skipIf(!pathDir)("bash: a new terminal finds bun when both startup files exist", async () => {
    using home = tempDir("install-sh-home", bashHome);
    const h = String(home);

    const { stdout, exitCode } = await runInstaller(h, "/bin/bash");
    expect(stdout).toContain("bun was installed successfully to ~/.bun/bin/bun");
    expect(exitCode).toBe(0);

    const bin = join(h, ".bun/bin/bun");
    if (isMacOS) {
      expect(stdout).toContain('Added "~/.bun/bin" to $PATH in "~/.bash_profile"');
      expect([countBunBlocks(join(h, ".bash_profile")), countBunBlocks(join(h, ".bashrc"))]).toEqual([1, 0]);
    } else {
      expect(stdout).toContain('Added "~/.bun/bin" to $PATH in "~/.bashrc"');
      expect([countBunBlocks(join(h, ".bash_profile")), countBunBlocks(join(h, ".bashrc"))]).toEqual([0, 1]);
      expect(await bunOnPath(h, "-ic")).toBe(bin);
    }
    expect(await bunOnPath(h, "-lic")).toBe(bin);
  });

  test.skipIf(!pathDir)("bash: a second run does not append a second block", async () => {
    using home = tempDir("install-sh-home", bashHome);
    const h = String(home);
    const config = isLinux ? ".bashrc" : ".bash_profile";

    const first = await runInstaller(h, "/bin/bash");
    expect(first.stdout).toContain(`Added "~/.bun/bin" to $PATH in "~/${config}"`);
    expect(first.exitCode).toBe(0);

    const second = await runInstaller(h, "/bin/bash");
    expect(second.stdout).toContain(`"~/${config}" already adds "~/.bun/bin" to $PATH`);
    expect(second.stdout).toContain(`source ${join(h, config)}`);
    expect(second.exitCode).toBe(0);

    expect(countBunBlocks(join(h, ".bashrc")) + countBunBlocks(join(h, ".bash_profile"))).toBe(1);
  });

  test.skipIf(!pathDir)("zsh: a second run does not append a second block", async () => {
    using home = tempDir("install-sh-home", { ".zshrc": "# zsh\n" });
    const h = String(home);

    const first = await runInstaller(h, "/bin/zsh");
    expect(first.stdout).toContain('Added "~/.bun/bin" to $PATH in "~/.zshrc"');
    expect(first.exitCode).toBe(0);

    const second = await runInstaller(h, "/bin/zsh");
    expect(second.stdout).toContain('"~/.zshrc" already adds "~/.bun/bin" to $PATH');
    expect(second.exitCode).toBe(0);

    expect(readFileSync(join(h, ".zshrc"), "utf8")).toBe(
      '# zsh\n\n# bun\nexport BUN_INSTALL="$HOME/.bun"\nexport PATH="$BUN_INSTALL/bin:$PATH"\n',
    );
  });
});
