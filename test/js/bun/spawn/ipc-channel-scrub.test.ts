import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A bun CLI process that inherits an IPC channel (NODE_CHANNEL_FD) must not
// forward that channel to the scripts, tools, and lifecycle steps it spawns.
// Node sets the channel fd close-on-exec and deletes the environment variables
// before it spawns a child, so a `node`/`bun` grandchild starts without a
// channel. Before the fix, bun built every CLI child's environment straight
// from the real `environ`, which still carried NODE_CHANNEL_FD, so a `node`
// grandchild adopted a bogus channel and aborted, and any process in the
// command line could read or inject messages on the parent channel.
//
// The grandchild here is a POSIX shell, not bun or node. bun and node remove
// NODE_CHANNEL_FD from `process.env` while they adopt the channel, so they
// cannot report the raw inherited value. A shell reports it unchanged.
const SHOW_CHANNEL = [
  "#!/bin/sh",
  `printf 'NODE_CHANNEL_FD=[%s]\\n' "\${NODE_CHANNEL_FD:-}"`,
  `printf 'NODE_CHANNEL_SERIALIZATION_MODE=[%s]\\n' "\${NODE_CHANNEL_SERIALIZATION_MODE:-}"`,
  "",
].join("\n");

// Spawn `bun <args>` with an IPC channel, then return what the shell grandchild
// saw. `ipc` makes Bun.spawn create a channel and set NODE_CHANNEL_FD for the
// direct child.
async function channelSeenByGrandchild(args: string[], cwd: string): Promise<string> {
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
  expect(stderr).not.toContain("panic");
  expect(exitCode).toBe(0);
  return stdout;
}

test.skipIf(process.platform === "win32")("bun exec does not forward the inherited IPC channel", async () => {
  using dir = tempDir("ipc-scrub-exec", { "show.sh": SHOW_CHANNEL });
  const out = await channelSeenByGrandchild(["exec", "sh show.sh"], String(dir));
  expect(out).toContain("NODE_CHANNEL_FD=[]");
  expect(out).toContain("NODE_CHANNEL_SERIALIZATION_MODE=[]");
});

test.skipIf(process.platform === "win32")("bun run --shell=bun does not forward the inherited IPC channel", async () => {
  using dir = tempDir("ipc-scrub-bunshell", {
    "package.json": JSON.stringify({ name: "x", version: "1.0.0", scripts: { show: "sh show.sh" } }),
    "show.sh": SHOW_CHANNEL,
  });
  const out = await channelSeenByGrandchild(["run", "--shell=bun", "show"], String(dir));
  expect(out).toContain("NODE_CHANNEL_FD=[]");
  expect(out).toContain("NODE_CHANNEL_SERIALIZATION_MODE=[]");
});
