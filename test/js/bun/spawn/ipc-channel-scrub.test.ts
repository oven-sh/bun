import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// A bun CLI process that inherits an IPC channel (NODE_CHANNEL_FD) must not
// forward that channel to the scripts and tools it spawns, the way Node sets
// the channel fd close-on-exec and deletes the variables before it spawns.
//
// The grandchild is a POSIX shell, not bun or node: bun and node remove
// NODE_CHANNEL_FD from `process.env` while they adopt the channel, so only a
// shell reports the raw inherited value.
const SHOW_CHANNEL = [
  "#!/bin/sh",
  `printf 'NODE_CHANNEL_FD=[%s]\\n' "\${NODE_CHANNEL_FD:-}"`,
  `printf 'NODE_CHANNEL_SERIALIZATION_MODE=[%s]\\n' "\${NODE_CHANNEL_SERIALIZATION_MODE:-}"`,
  "",
].join("\n");

const NO_CHANNEL = "NODE_CHANNEL_FD=[]\nNODE_CHANNEL_SERIALIZATION_MODE=[]\n";

// Spawn `bun <args>` with an IPC channel (`ipc` makes Bun.spawn create one and
// set NODE_CHANNEL_FD for the direct child) and report what the grandchild saw.
async function runWithChannel(args: string[], cwd: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ipc() {},
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent.skipIf(isWindows)("bun exec does not forward the inherited IPC channel", async () => {
  using dir = tempDir("ipc-scrub-exec", { "show.sh": SHOW_CHANNEL });
  const { stdout, stderr, exitCode } = await runWithChannel(["exec", "sh show.sh"], String(dir));
  expect(stdout).toBe(NO_CHANNEL);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
});

test.concurrent.skipIf(isWindows)("bun run --shell=bun does not forward the inherited IPC channel", async () => {
  using dir = tempDir("ipc-scrub-bunshell", {
    "package.json": JSON.stringify({ name: "x", version: "1.0.0", scripts: { show: "sh show.sh" } }),
    "show.sh": SHOW_CHANNEL,
  });
  const { stdout, stderr, exitCode } = await runWithChannel(["run", "--silent", "--shell=bun", "show"], String(dir));
  expect(stdout).toBe(NO_CHANNEL);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
});
