import { spawn } from "bun";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// The stand-in ssh transport for git dependency tests: logs the call, skips
// options, drops the host, and runs the command locally, so scp-form and ssh
// URL dependencies work offline. git for Windows cannot run a shell script
// transport, so tests using it skip on Windows.
export const fakeSshScript = `#!/bin/sh
echo "$*" >> "$(dirname "$0")/ssh.log"
while [ $# -gt 1 ]; do
  case "$1" in
    -o|-p) shift 2 ;;
    -*) shift ;;
    *) break ;;
  esac
done
shift
exec sh -c "$1"
`;

export function gitIn(cwd: string, ...args: string[]): string {
  const { exitCode, stdout, stderr } = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.toString()}`);
  return stdout.toString();
}

// Commits `upstream` (which already holds a package.json), clones it to the
// bare repo the fake ssh serves, and returns the commit sha.
export function makeBareRepo(dir: string, upstream: string, bare: string): string {
  gitIn(join(dir, upstream), "init", "-q");
  gitIn(join(dir, upstream), "add", "package.json");
  gitIn(join(dir, upstream), "-c", "user.email=test@bun.com", "-c", "user.name=bun-test", "commit", "-qm", "init");
  gitIn(dir, "clone", "-q", "--bare", upstream, bare);
  return gitIn(join(dir, upstream), "rev-parse", "HEAD").trim();
}

export function sshInstallEnv(dir: string, cache: string): Record<string, string | undefined> {
  return {
    ...bunEnv,
    BUN_INSTALL_CACHE_DIR: join(dir, cache),
    GIT_SSH_COMMAND: join(dir, "fake-ssh.sh"),
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "echo",
  };
}

// Isolated install with stdout/stderr drained concurrently, and the exit
// bounded by a deadline instead of the test timeout: the regressions these
// tests cover make the install never exit on its own. Returns stderr so a
// failure can surface git's diagnostics.
export async function runIsolatedInstall(
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<{ exitCode: number | "install hung"; stderr: string }> {
  await using proc = spawn({
    cmd: [bunExe(), "install", "--linker", "isolated"],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout.text();
  const stderr = proc.stderr.text();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<"install hung">(resolve => {
    deadline = setTimeout(() => resolve("install hung"), 60_000);
  });
  const exitCode = await Promise.race([proc.exited, hung]);
  clearTimeout(deadline);
  if (exitCode === "install hung") {
    proc.kill();
    await proc.exited;
  }
  await stdout;
  return { exitCode, stderr: await stderr };
}
