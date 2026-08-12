import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The inspector runs on a second VirtualMachine on its own thread (start_js_debugger_thread in
// src/jsc/Debugger.rs). That VM needs a dotenv Loader of its own: without one, Transpiler::init
// falls back to the process-wide instance, which is the main VM's loader, and the debugger VM's
// configure_defines() then loads .env files into the map the main thread is using (#22206).
//
// The fixture runs with --env-file=custom.env next to a .env file, so the main VM must never see
// MARKER. The debugger VM runs with default env options and does load .env; with a shared loader
// that shows up on the main thread, both in process.env and in the environment of child processes
// (which is built from the VM's env map, not from the process.env object).
const MARKER = "DEBUGGER_THREAD_ENV_LOADER_MARKER";

type Mode = "none" | "connect" | "inspector.open";

const fixture = /* ts */ `
  import { open } from "node:inspector";

  const [mode, cleanDir] = process.argv.slice(2);
  if (mode === "inspector.open") {
    // Returns once the debugger thread reports its server as listening, which happens after
    // that thread's VM has loaded its env files.
    open(0);
  } else if (mode === "connect") {
    // The test closes our stdin once the debugger thread has connected to it.
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

async function runFixture(mode: Mode, args: string[]) {
  using dir = tempDir("debugger-thread-env-loader", {
    ".env": `${MARKER}=loaded-from-dotenv\n`,
    "custom.env": "UNRELATED=1\n",
    "fixture.ts": fixture,
  });
  // The grandchild runs here so that it cannot load the .env above on its own.
  using cleanDir = tempDir("debugger-thread-env-loader-clean", {});
  const env: Record<string, string | undefined> = { ...bunEnv, [MARKER]: undefined };

  const { promise: debuggerConnected, resolve: onDebuggerConnected } = Promise.withResolvers<void>();
  using listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open: () => onDebuggerConnected(),
      data() {},
    },
  });
  if (mode === "connect") {
    env.BUN_INSPECT_CONNECT_TO = `tcp://127.0.0.1:${listener.port}`;
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args, "fixture.ts", mode, String(cleanDir)],
    cwd: String(dir),
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (mode === "connect") {
    await Promise.race([
      debuggerConnected,
      proc.exited.then(code => {
        throw new Error(`fixture exited with code ${code} before its debugger thread connected`);
      }),
    ]);
  }
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: JSON.parse(stdout), stderr, exitCode };
}

const loaded = { processEnv: "loaded-from-dotenv", childEnv: "loaded-from-dotenv" };
const excluded = { processEnv: null, childEnv: null };

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
    stderr: expect.stringMatching(/^Debugger listening on ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+\n$/),
    exitCode: 0,
  });
});
