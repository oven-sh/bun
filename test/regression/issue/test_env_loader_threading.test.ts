import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";

// The inspector runs on a second VirtualMachine on its own thread (start_js_debugger_thread in
// src/jsc/Debugger.rs). That VM gets a dotenv Loader of its own, filled from the process
// environment only. Without one, Transpiler::init falls back to the process-wide instance, which is
// the main VM's loader, and the debugger VM's configure_defines() then loads the cwd's .env files
// into the map the main thread is using (#22206).
//
// The fixture runs with --env-file=custom.env next to a .env file, so the main VM must never see
// MARKER. With a shared loader it shows up on the main thread anyway, both in process.env and in the
// environment of child processes (which is built from the VM's env map, not from the process.env
// object). BUN_INSPECT_NOTIFY is read through the debugger VM's own process.env, so the "inspect"
// mode also checks that the debugger VM does see the process environment.
const MARKER = "DEBUGGER_THREAD_ENV_LOADER_MARKER";

type Mode = "none" | "connect" | "inspect" | "inspector.open";

const fixture = /* ts */ `
  import { open } from "node:inspector";

  const [mode, cleanDir] = process.argv.slice(2);
  if (mode === "inspector.open") {
    // Returns once the debugger thread reports its server as listening, which happens after
    // that thread's VM has been set up.
    open(0);
  } else if (mode === "connect" || mode === "inspect") {
    // The test closes our stdin once the debugger thread has reached its listener.
    await Bun.stdin.text();
  }

  const child = Bun.spawnSync({
    cmd: [process.execPath, "-e", "console.log(JSON.stringify(process.env.${MARKER} ?? null))"],
    cwd: cleanDir,
  });
  console.log(
    JSON.stringify({
      processEnv: process.env.${MARKER} ?? null,
      childEnv: JSON.parse(child.stdout.toString()),
    }),
  );
`;

async function runFixture(mode: Mode, args: string[], { brokenDotEnv = false } = {}) {
  using dir = tempDir("debugger-thread-env-loader", {
    ...(brokenDotEnv ? {} : { ".env": `${MARKER}=loaded-from-dotenv\n` }),
    "custom.env": "UNRELATED=1\n",
    "fixture.ts": fixture,
  });
  if (brokenDotEnv) {
    // Opening this fails with ELOOP, which the env loader does not tolerate.
    symlinkSync(".env", join(String(dir), ".env"));
  }
  // The grandchild runs here so that it cannot load the .env above on its own.
  using cleanDir = tempDir("debugger-thread-env-loader-clean", {});
  const env: Record<string, string | undefined> = { ...bunEnv, [MARKER]: undefined };

  const { promise: connected, resolve: onConnected } = Promise.withResolvers<void>();
  const { promise: notified, resolve: onNotified } = Promise.withResolvers<string>();
  using listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open: () => onConnected(),
      data: (_socket, payload) => onNotified(payload.toString()),
    },
  });
  let reached: Promise<unknown> | undefined;
  if (mode === "connect") {
    env.BUN_INSPECT_CONNECT_TO = `tcp://127.0.0.1:${listener.port}`;
    reached = connected;
  } else if (mode === "inspect") {
    args = ["--inspect=127.0.0.1:0", ...args];
    env.BUN_INSPECT_NOTIFY = `tcp://127.0.0.1:${listener.port}`;
    reached = notified;
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args, "fixture.ts", mode, String(cleanDir)],
    cwd: String(dir),
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (reached) {
    await Promise.race([
      reached,
      proc.exited.then(code => {
        throw new Error(`fixture exited with code ${code} before its debugger thread reached the test's listener`);
      }),
    ]);
  }
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    stdout: stdout === "" ? stdout : JSON.parse(stdout),
    stderr: stderr.replaceAll(/127\.0\.0\.1:\d+\/[0-9a-z-]+/g, "127.0.0.1:PORT/ID"),
    exitCode,
    ...(mode === "inspect" ? { notification: await notified } : {}),
  };
}

const loaded = { processEnv: "loaded-from-dotenv", childEnv: "loaded-from-dotenv" };
const excluded = { processEnv: null, childEnv: null };
const inspectorOpenStderr = "Debugger listening on ws://127.0.0.1:PORT/ID\n";
const inspectBanner =
  "--------------------- Bun Inspector ---------------------\n" +
  "Listening:\n" +
  "  ws://127.0.0.1:PORT/ID\n" +
  "Inspect in browser:\n" +
  "  https://debug.bun.sh/#127.0.0.1:PORT/ID\n" +
  "--------------------- Bun Inspector ---------------------\n";

test.concurrent("the .env fixture is loaded by default", async () => {
  expect(await runFixture("none", [])).toEqual({ stdout: loaded, stderr: "", exitCode: 0 });
});

test.concurrent("--env-file excludes .env", async () => {
  expect(await runFixture("none", ["--env-file=custom.env"])).toEqual({ stdout: excluded, stderr: "", exitCode: 0 });
});

test.concurrent("the main VM still loads .env while a debugger thread is running", async () => {
  expect(await runFixture("connect", [])).toEqual({ stdout: loaded, stderr: "", exitCode: 0 });
});

test.concurrent(
  "the debugger thread started by BUN_INSPECT_CONNECT_TO does not load .env into the main VM",
  async () => {
    expect(await runFixture("connect", ["--env-file=custom.env"])).toEqual({
      stdout: excluded,
      stderr: "",
      exitCode: 0,
    });
  },
);

test.concurrent("the debugger thread started by inspector.open() does not load .env into the main VM", async () => {
  expect(await runFixture("inspector.open", ["--env-file=custom.env"])).toEqual({
    stdout: excluded,
    stderr: inspectorOpenStderr,
    exitCode: 0,
  });
});

test.concurrent(
  "the debugger thread started by --inspect does not load .env into the main VM and still sees BUN_INSPECT_NOTIFY",
  async () => {
    expect(await runFixture("inspect", ["--env-file=custom.env"])).toEqual({
      stdout: excluded,
      stderr: inspectBanner,
      exitCode: 0,
      notification: "1",
    });
  },
);

// Creating the symlink needs a privilege on Windows.
test.concurrent.skipIf(isWindows)("the debugger thread does not open a .env the main VM was told to skip", async () => {
  expect(await runFixture("inspector.open", ["--env-file=custom.env"], { brokenDotEnv: true })).toEqual({
    stdout: excluded,
    stderr: inspectorOpenStderr,
    exitCode: 0,
  });
});
