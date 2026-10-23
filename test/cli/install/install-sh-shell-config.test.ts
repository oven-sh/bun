import { afterAll, describe, expect, test } from "bun:test";
import { isMacOS, isWindows, tempDir } from "harness";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
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

async function runInstaller(home: string, shell: string, extraEnv: Record<string, string> = {}) {
  using server = startReleaseServer();
  await using proc = Bun.spawn({
    cmd: ["bash", installScript],
    env: { ...shellEnv(home, shell, server.url.origin), ...extraEnv },
    cwd: home,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Starts bash the way a terminal does (`-ic`: interactive non-login, as a
// Linux terminal; `-lic`: interactive login, as a macOS terminal) and reports
// which `bun` it finds. The system startup files can print to stdout too
// (the Ubuntu sudo hint), so the answer sits behind a marker.
async function bunOnPath(home: string, flags: "-ic" | "-lic") {
  await using proc = Bun.spawn({
    cmd: ["bash", flags, 'echo "bun-on-path=$(command -v bun || echo none)"'],
    env: shellEnv(home, "/bin/bash"),
    cwd: home,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return /^bun-on-path=(.*)$/m.exec(stdout)?.[1];
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
    const config = isMacOS ? ".bash_profile" : ".bashrc";

    const first = await runInstaller(h, "/bin/bash");
    expect(first.stdout).toContain(`Added "~/.bun/bin" to $PATH in "~/${config}"`);
    expect(first.exitCode).toBe(0);

    const second = await runInstaller(h, "/bin/bash");
    expect(second.stdout).toContain(`"~/${config}" already adds "~/.bun/bin" to $PATH`);
    expect(second.stdout).toContain(`source ${join(h, config)}`);
    expect(second.exitCode).toBe(0);

    expect(countBunBlocks(join(h, ".bashrc")) + countBunBlocks(join(h, ".bash_profile"))).toBe(1);
  });

  test.skipIf(!pathDir || isMacOS)("bash: a hand-written ~/.bash_profile gets the block for login shells", async () => {
    using home = tempDir("install-sh-home", {
      ".bash_profile": "# this profile does not source ~/.bashrc\nexport EDITOR=vi\n",
      ".bashrc": 'PS1="$ "\n',
    });
    const h = String(home);

    const { stdout, exitCode } = await runInstaller(h, "/bin/bash");
    expect(stdout).toContain('Added "~/.bun/bin" to $PATH in "~/.bashrc"');
    expect(stdout).toContain('Added "~/.bun/bin" to $PATH in "~/.bash_profile" for login shells');
    expect(exitCode).toBe(0);

    const bin = join(h, ".bun/bin/bun");
    expect([countBunBlocks(join(h, ".bash_profile")), countBunBlocks(join(h, ".bashrc"))]).toEqual([1, 1]);
    expect(await bunOnPath(h, "-ic")).toBe(bin);
    expect(await bunOnPath(h, "-lic")).toBe(bin);
  });

  test.skipIf(!pathDir)("bash: a second run with another BUN_INSTALL appends a block for it", async () => {
    using home = tempDir("install-sh-home", bashHome);
    const h = String(home);
    const config = join(h, isMacOS ? ".bash_profile" : ".bashrc");

    const first = await runInstaller(h, "/bin/bash");
    expect(first.exitCode).toBe(0);

    const second = await runInstaller(h, "/bin/bash", { BUN_INSTALL: join(h, "other") });
    expect(second.stdout).toContain(`Added "~/other/bin" to $PATH in`);
    expect(second.exitCode).toBe(0);

    expect(countBunBlocks(config)).toBe(2);
    expect(readFileSync(config, "utf8")).toEndWith(
      '\n# bun\nexport BUN_INSTALL="$HOME/other"\nexport PATH="$BUN_INSTALL/bin:$PATH"\n',
    );
    expect(await bunOnPath(h, "-lic")).toBe(join(h, "other/bin/bun"));

    // Back to the default dir: the lines exist, but a later block wins, so
    // a new block is needed.
    const third = await runInstaller(h, "/bin/bash");
    expect(third.stdout).toContain(`Added "~/.bun/bin" to $PATH in`);
    expect(third.exitCode).toBe(0);
    expect(countBunBlocks(config)).toBe(3);
    expect(await bunOnPath(h, "-lic")).toBe(join(h, ".bun/bin/bun"));
  });

  test.skipIf(!pathDir || isMacOS)("bash: a Debian home with ~/.profile and no ~/.bash_profile", async () => {
    using home = tempDir("install-sh-home", {
      ".profile":
        'if [ -n "$BASH_VERSION" ]; then\n    if [ -f "$HOME/.bashrc" ]; then\n        . "$HOME/.bashrc"\n    fi\nfi\n',
      ".bashrc": "case $- in\n    *i*) ;;\n    *) return;;\nesac\n",
    });
    const h = String(home);

    const { stdout, exitCode } = await runInstaller(h, "/bin/bash");
    expect(stdout).toContain('Added "~/.bun/bin" to $PATH in "~/.bashrc"');
    expect(exitCode).toBe(0);

    const bin = join(h, ".bun/bin/bun");
    expect(countBunBlocks(join(h, ".bashrc"))).toBe(1);
    expect(existsSync(join(h, ".bash_profile"))).toBe(false);
    expect(await bunOnPath(h, "-ic")).toBe(bin);
    expect(await bunOnPath(h, "-lic")).toBe(bin);
  });

  test.skipIf(!pathDir)("bash: a sibling BUN_INSTALL_CACHE_DIR line does not hide the block", async () => {
    using home = tempDir("install-sh-home", bashHome);
    const h = String(home);
    const config = join(h, isMacOS ? ".bash_profile" : ".bashrc");

    const first = await runInstaller(h, "/bin/bash");
    expect(first.exitCode).toBe(0);
    appendFileSync(config, 'export BUN_INSTALL_CACHE_DIR="$HOME/cache"\n');

    const second = await runInstaller(h, "/bin/bash");
    expect(second.stdout).toContain(`already adds "~/.bun/bin" to $PATH`);
    expect(second.exitCode).toBe(0);
    expect(countBunBlocks(config)).toBe(1);
  });

  test.skipIf(!pathDir)("bash: a failed write aborts instead of reporting success", async () => {
    // The startup file is a directory: `-w` passes, the append fails.
    const config = isMacOS ? ".bash_profile" : ".bashrc";
    using home = tempDir("install-sh-home", { [`${config}/.keep`]: "" });
    const h = String(home);

    const { stdout, stderr, exitCode } = await runInstaller(h, "/bin/bash");
    expect(stderr).toContain(`error: Failed to write to "${join(h, config)}"`);
    expect(stdout).not.toContain("already adds");
    expect(exitCode).toBe(1);
  });

  test.skipIf(!pathDir)("fish: a second run does not append a second block", async () => {
    using home = tempDir("install-sh-home", { ".config/fish/config.fish": "# fish\n" });
    const h = String(home);
    const config = join(h, ".config/fish/config.fish");

    const first = await runInstaller(h, "/usr/bin/fish");
    expect(first.stdout).toContain('Added "~/.bun/bin" to $PATH in "~/.config/fish/config.fish"');
    expect(first.exitCode).toBe(0);
    expect(readFileSync(config, "utf8")).toBe(
      '# fish\n\n# bun\nset --export BUN_INSTALL "$HOME/.bun"\nset --export PATH $BUN_INSTALL/bin $PATH\n',
    );
    appendFileSync(config, 'set --export BUN_INSTALL_CACHE_DIR "$HOME/cache"\n');

    const second = await runInstaller(h, "/usr/bin/fish");
    expect(second.stdout).toContain('"~/.config/fish/config.fish" already adds "~/.bun/bin" to $PATH');
    expect(second.exitCode).toBe(0);
    expect(countBunBlocks(config)).toBe(1);
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
