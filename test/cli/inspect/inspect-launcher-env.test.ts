import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { join } from "node:path";

// A debugger frontend (the VS Code extension, bun-debug-adapter-protocol)
// launches a program with BUN_INSPECT pointing at the socket it should listen
// on and BUN_INSPECT_NOTIFY pointing at where to say that it is listening. Both
// are addressed to that one process: anything the program spawns must not see
// them, or every child `bun` tries to bring up an inspector on the same address.
// BUN_INSPECT_CONNECT_TO is different: it is set on a whole terminal and every
// bun process started in it, children included, is meant to connect.
const fixture = join(import.meta.dir, "launcher-env-fixture.ts");

function expectedReport(connectTo: string) {
  const env = { BUN_INSPECT: null, BUN_INSPECT_NOTIFY: null, BUN_INSPECT_CONNECT_TO: connectTo };
  return {
    self: env,
    worker: env,
    "node:child_process": { exitCode: 0, env },
    "Bun.spawn": { exitCode: 0, env },
  };
}

// Nothing listens here, so whatever is told to connect to it fails at once.
function unusedTcpAddress(): string {
  using probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  return `tcp://127.0.0.1:${probe.port}`;
}

describe.concurrent("BUN_INSPECT launch environment", () => {
  test("BUN_INSPECT and BUN_INSPECT_NOTIFY stop at the launched program; BUN_INSPECT_CONNECT_TO is passed on", async () => {
    const connectTo = unusedTcpAddress();
    await using proc = spawn({
      cmd: [bunExe(), fixture],
      env: {
        ...bunEnv,
        BUN_INSPECT: `ws://127.0.0.1:0/${crypto.randomUUID()}`,
        BUN_INSPECT_NOTIFY: unusedTcpAddress(),
        BUN_INSPECT_CONNECT_TO: connectTo,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expectedReport(connectTo));
    expect(exitCode).toBe(0);
  });

  // The full launch sequence as the extension runs it on POSIX: the program
  // listens on the unix socket named by BUN_INSPECT and waits, reports to
  // BUN_INSPECT_NOTIFY, we attach, and only then does the program run. A child
  // inheriting BUN_INSPECT here would try to listen on the very socket we are
  // attached to and die with EADDRINUSE before running a line of its own code.
  test.skipIf(!isPosix).each(["unix", "tcp"])(
    "children of a program launched by a debugger run undebugged (notified over %s)",
    async notifyTransport => {
      using dir = tempDir("inspect-launch", {});
      const inspectorSocket = join(String(dir), "inspector.sock");
      const notifySocket = join(String(dir), "notify.sock");

      const notified = Promise.withResolvers<string>();
      const socket = {
        data(_socket: unknown, data: Buffer) {
          notified.resolve(data.toString());
        },
        error(_socket: unknown, error: Error) {
          notified.reject(error);
        },
      };
      using signal =
        notifyTransport === "unix"
          ? Bun.listen({ unix: notifySocket, socket })
          : Bun.listen({ hostname: "127.0.0.1", port: 0, socket });
      const notifyUrl = notifyTransport === "unix" ? `unix://${notifySocket}` : `tcp://127.0.0.1:${signal.port}`;

      const connectTo = unusedTcpAddress();
      await using proc = spawn({
        cmd: [bunExe(), fixture],
        env: {
          ...bunEnv,
          BUN_INSPECT: `ws+unix://${inspectorSocket}?wait=1`,
          BUN_INSPECT_NOTIFY: notifyUrl,
          BUN_INSPECT_CONNECT_TO: connectTo,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitedEarly = proc.exited.then(code => {
        throw new Error(`program exited with ${code} before a frontend attached`);
      });
      exitedEarly.catch(() => {});

      expect(await Promise.race([notified.promise, exitedEarly])).toBe("1");

      const frontend = new globalThis.WebSocket(`ws+unix://${inspectorSocket}`);
      try {
        await Promise.race([
          new Promise<void>((resolve, reject) => {
            frontend.onopen = () => resolve();
            frontend.onerror = event => reject(new Error("could not attach", { cause: event }));
            frontend.onclose = event => reject(new Error(`inspector closed the connection: ${event.code}`));
          }),
          exitedEarly,
        ]);
        frontend.send(JSON.stringify({ id: 1, method: "Inspector.enable" }));
        frontend.send(JSON.stringify({ id: 2, method: "Inspector.initialized" }));

        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expectedReport(connectTo));
        expect(exitCode).toBe(0);
      } finally {
        frontend.close();
      }
    },
  );
});
