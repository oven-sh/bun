import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

test("env_loader should not have allocator threading issues with BUN_INSPECT_CONNECT_TO", async () => {
  await using dir = tempDir("env-loader-threading", {
    ".env": "TEST_ENV_VAR=hello_world",
    "index.js": `console.log(process.env.TEST_ENV_VAR || 'undefined');`,
  });

  // This test verifies that when BUN_INSPECT_CONNECT_TO is set,
  // the debugger thread creates its own env_loader with proper allocator isolation
  // and doesn't cause threading violations when accessing environment files.

  // First, test normal execution without inspector to establish baseline
  const normalProc = spawn({
    cmd: [bunExe(), "index.js"],
    cwd: dir,
    env: {
      ...Bun.env,
      TEST_ENV_VAR: undefined, // Remove from process env to test .env loading
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  const normalResult = await normalProc.exited;
  const normalStdout = await normalProc.stdout.text();

  expect(normalResult).toBe(0);
  expect(normalStdout.trim()).toBe("hello_world");

  // Now test with BUN_INSPECT_CONNECT_TO set to a non-existent socket
  // This should trigger the debugger thread creation without actually connecting
  const inspectorProc = spawn({
    cmd: [bunExe(), "index.js"],
    cwd: dir,
    env: {
      ...Bun.env,
      BUN_INSPECT_CONNECT_TO: "/tmp/non-existent-debug-socket",
      TEST_ENV_VAR: undefined, // Remove from process env to test .env loading
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  const inspectorResult = await inspectorProc.exited;
  const inspectorStdout = await inspectorProc.stdout.text();
  const inspectorStderr = await inspectorProc.stderr.text();

  // The process should still work correctly and load .env file
  expect(inspectorResult).toBe(0);
  expect(inspectorStdout.trim()).toBe("hello_world");

  // Should not have any allocator-related errors or panics
  expect(inspectorStderr).not.toContain("panic");
  expect(inspectorStderr).not.toContain("allocator");
  expect(inspectorStderr).not.toContain("thread");
  expect(inspectorStderr).not.toContain("assertion failed");
}, 10000); // 10 second timeout for potential debugger connection attempts

// The debugger thread's VM (start_js_debugger_thread in src/jsc/Debugger.rs) must take the main VM's
// environment as it is: not parse it again (the define setup JSON-parses NODE_ENV and fails on a value
// that is not valid JSON) and not load .env files of its own into the process.
//
// Once that VM is up, the debugger thread connects to BUN_INSPECT_NOTIFY (src/js/internal/debugger.ts).
// The fixtures wait for stdin, which is closed after that notification, so what they print was
// observed after the debugger thread finished its setup. A debugger thread that aborts takes the
// process down before the notification instead.
async function runUnderInspector(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  const { promise: notified, resolve: onNotified } = Promise.withResolvers<string>();
  using listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data: (_socket, payload) => onNotified(payload.toString()),
    },
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    cwd,
    env: { ...bunEnv, ...env, BUN_INSPECT_NOTIFY: `tcp://127.0.0.1:${listener.port}` },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = Promise.all([proc.stdout.text(), proc.stderr.text()]);

  const notifiedOrExited = await Promise.race([notified, proc.exited]);
  proc.stdin.end();
  const [stdout, stderr] = await output;
  const exitCode = await proc.exited;
  return {
    notification: typeof notifiedOrExited === "string" ? notifiedOrExited : null,
    // Only the fixture itself prints JSON; `bun test` adds its own report around it.
    report: stdout
      .split("\n")
      .filter(line => line.startsWith("{"))
      .map(line => JSON.parse(line)),
    exitCode,
    signalCode: proc.signalCode,
    stderrIfFailed: exitCode === 0 ? "" : stderr,
  };
}

// Neither value survives being wrapped in double quotes and parsed as JSON. The first one is what a
// CRLF env file leaves behind when the tool that launched bun does not strip the \r.
const invalidNodeEnvs: [variable: string, value: string][] = [
  ["NODE_ENV", "development\r"],
  ["BUN_ENV", "test\\"],
];

test.concurrent.each(invalidNodeEnvs)(
  "--inspect starts when %s holds a value that is not valid JSON",
  async (variable, value) => {
    using dir = tempDir("debugger-thread-invalid-node-env", {
      "fixture.ts": `
        await Bun.stdin.text();
        console.log(JSON.stringify({ [${JSON.stringify(variable)}]: process.env[${JSON.stringify(variable)}] }));
      `,
    });

    const result = await runUnderInspector(["--inspect=127.0.0.1:0", "fixture.ts"], String(dir), {
      NODE_ENV: undefined,
      BUN_ENV: undefined,
      [variable]: value,
    });
    expect(result).toEqual({
      notification: "1",
      report: [{ [variable]: value }],
      exitCode: 0,
      signalCode: null,
      stderrIfFailed: "",
    });
  },
);

test.concurrent.each(invalidNodeEnvs)(
  "inspector.open() starts when %s holds a value that is not valid JSON",
  async (variable, value) => {
    using dir = tempDir("debugger-thread-invalid-node-env-open", {
      "fixture.ts": `
        import inspector from "node:inspector";
        // Returns once the debugger thread reports its server as listening.
        inspector.open(0, "127.0.0.1");
        console.log(JSON.stringify({ url: typeof inspector.url(), [${JSON.stringify(variable)}]: process.env[${JSON.stringify(variable)}] }));
        inspector.close();
      `,
    });

    await using proc = spawn({
      cmd: [bunExe(), "fixture.ts"],
      cwd: String(dir),
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined, [variable]: value },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode, signalCode: proc.signalCode, stderrIfFailed: exitCode === 0 ? "" : stderr }).toEqual({
      stdout: JSON.stringify({ url: "string", [variable]: value }) + "\n",
      exitCode: 0,
      signalCode: null,
      stderrIfFailed: "",
    });
    expect(stderr).toContain("Debugger listening on ws://127.0.0.1:");
  },
);

// `bun test` loads .env.test* and .env, never .env.local or .env.development, whatever NODE_ENV says.
// A debugger thread that picks .env files from NODE_ENV=development on its own adds the other two.
// Children get their environment from the env map (Bun.spawn), not from the process.env object, so
// the grandchild shows the map's state no matter when process.env was materialized.
test.concurrent("the debugger thread does not load .env files into a bun test process", async () => {
  const keys = ["FROM_ENV", "FROM_ENV_LOCAL", "FROM_ENV_DEVELOPMENT"];
  using dir = tempDir("debugger-thread-bun-test-dotenv", {
    "project/.env": "FROM_ENV=1\n",
    "project/.env.local": "FROM_ENV_LOCAL=1\n",
    "project/.env.development": "FROM_ENV_DEVELOPMENT=1\n",
    "project/env.test.ts": `
      import { test } from "bun:test";
      import { dirname } from "node:path";

      const keys = ${JSON.stringify(keys)};
      const pick = (env: Record<string, string | undefined>) =>
        Object.fromEntries(keys.map(key => [key, env[key] ?? null]));

      test("report the environment", async () => {
        await Bun.stdin.text();
        // The parent directory holds no .env files, so the child can only inherit these.
        const child = Bun.spawnSync({
          cmd: [process.execPath, "-e", "console.log(JSON.stringify(process.env))"],
          cwd: dirname(import.meta.dir),
        });
        console.log(
          JSON.stringify({ processEnv: pick(process.env), childEnv: pick(JSON.parse(child.stdout.toString())) }),
        );
      });
    `,
  });

  const result = await runUnderInspector(
    ["test", "--inspect=127.0.0.1:0", "./env.test.ts"],
    join(String(dir), "project"),
    {
      NODE_ENV: "development",
      BUN_ENV: undefined,
      ...Object.fromEntries(keys.map(key => [key, undefined])),
    },
  );
  const loadedByBunTest = { FROM_ENV: "1", FROM_ENV_LOCAL: null, FROM_ENV_DEVELOPMENT: null };
  expect(result).toEqual({
    notification: "1",
    report: [{ processEnv: loadedByBunTest, childEnv: loadedByBunTest }],
    exitCode: 0,
    signalCode: null,
    stderrIfFailed: "",
  });
});
