import { spawn, type Subprocess } from "bun";
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

// The BUN_INSPECT_NOTIFY side of the launcher: collects what connects to it.
function notifyListener(address: { unix: string } | { tcp: true }) {
  const first = Promise.withResolvers<string>();
  const received: string[] = [];
  const socket = {
    data(_socket: unknown, data: Buffer) {
      received.push(data.toString());
      first.resolve(received[0]);
    },
    error(_socket: unknown, error: Error) {
      first.reject(error);
    },
  };
  const listener =
    "unix" in address
      ? Bun.listen({ unix: address.unix, socket })
      : Bun.listen({ hostname: "127.0.0.1", port: 0, socket });
  return {
    url: "unix" in address ? `unix://${address.unix}` : `tcp://127.0.0.1:${listener.port}`,
    first: first.promise,
    received,
    [Symbol.dispose]() {
      listener.stop(true);
    },
  };
}

// Rejects as soon as the program exits; raced against things it must do first.
function exitsTooEarly(proc: Subprocess): Promise<never> {
  const exited = proc.exited.then(code => {
    throw new Error(`program exited with ${code} first`);
  });
  exited.catch(() => {});
  return exited;
}

// Attach to a program started in wait mode and let it run.
async function attach(url: string, proc: Subprocess): Promise<WebSocket> {
  const frontend = new WebSocket(url);
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        frontend.onopen = () => resolve();
        frontend.onerror = event => reject(new Error("could not attach", { cause: event }));
        frontend.onclose = event => reject(new Error(`inspector closed the connection: ${event.code}`));
      }),
      exitsTooEarly(proc),
    ]);
  } catch (error) {
    frontend.close();
    throw error;
  }
  frontend.send(JSON.stringify({ id: 1, method: "Inspector.enable" }));
  frontend.send(JSON.stringify({ id: 2, method: "Inspector.initialized" }));
  return frontend;
}

// `--inspect-wait` prints the URL it is serving on; BUN_INSPECT does not.
function printedInspectorUrl(proc: Subprocess<"ignore", "pipe", "pipe">) {
  const url = Promise.withResolvers<string>();
  const decoder = new TextDecoder();
  let text = "";
  const stderr = (async () => {
    for await (const chunk of proc.stderr) {
      text += decoder.decode(chunk, { stream: true });
      // Only complete lines: the last element is whatever follows the final newline so far.
      const line = text
        .split("\n")
        .slice(0, -1)
        .find(line => line.trimStart().startsWith("ws://"));
      if (line) url.resolve(line.trim());
    }
    url.reject(new Error(`no inspector URL in stderr:\n${text}`));
    return text;
  })();
  return { url: url.promise, stderr };
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

  // The launch sequence as the extension runs it on POSIX: the program listens
  // on the unix socket named by BUN_INSPECT and waits, reports to
  // BUN_INSPECT_NOTIFY, we attach, and only then does the program run. A child
  // inheriting BUN_INSPECT here tries to listen on the very socket we are
  // attached to and dies with EADDRINUSE before running a line of its own code.
  test.skipIf(!isPosix).each(["unix", "tcp"] as const)(
    "children of a program launched by a debugger run undebugged (notified over %s)",
    async notifyTransport => {
      using dir = tempDir("inspect-launch", {});
      const inspectorSocket = join(String(dir), "inspector.sock");
      using notify = notifyListener(
        notifyTransport === "unix" ? { unix: join(String(dir), "notify.sock") } : { tcp: true },
      );
      const connectTo = unusedTcpAddress();

      await using proc = spawn({
        cmd: [bunExe(), fixture],
        env: {
          ...bunEnv,
          BUN_INSPECT: `ws+unix://${inspectorSocket}?wait=1`,
          BUN_INSPECT_NOTIFY: notify.url,
          BUN_INSPECT_CONNECT_TO: connectTo,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await Promise.race([notify.first, exitsTooEarly(proc)])).toBe("1");

      const frontend = await attach(`ws+unix://${inspectorSocket}`, proc);
      try {
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expectedReport(connectTo));
        expect(exitCode).toBe(0);
      } finally {
        frontend.close();
      }
    },
  );

  // The notification is also sent for an inspector started from the command
  // line, and once when both are configured (BUN_INSPECT's server starts first
  // and is the one that reports).
  test.each([
    ["--inspect-wait", {}],
    ["--inspect-wait together with BUN_INSPECT", { BUN_INSPECT: `ws://127.0.0.1:0/${crypto.randomUUID()}` }],
  ])("%s reports to BUN_INSPECT_NOTIFY once", async (_, inspectEnv) => {
    using notify = notifyListener({ tcp: true });
    await using proc = spawn({
      cmd: [
        bunExe(),
        "--inspect-wait=127.0.0.1:0",
        "-e",
        `Bun.write(Bun.stdout, "ran\\n").then(() => process.exit(0))`,
      ],
      env: { ...bunEnv, ...inspectEnv, BUN_INSPECT_NOTIFY: notify.url },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const printed = printedInspectorUrl(proc);
    const url = await Promise.race([printed.url, exitsTooEarly(proc)]);
    expect(await Promise.race([notify.first, exitsTooEarly(proc)])).toBe("1");

    const frontend = await attach(url, proc);
    try {
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited, printed.stderr]);

      expect(stdout).toBe("ran\n");
      expect(exitCode).toBe(0);
      expect(notify.received).toEqual(["1"]);
    } finally {
      frontend.close();
    }
  });
});
