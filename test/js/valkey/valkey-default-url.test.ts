import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Removes one complete `*N\r\n` array of `$len\r\n<bytes>\r\n` bulk strings from
// the front of `state.buf` and returns its items, or null while it is incomplete.
function takeCommand(state: { buf: string }): string[] | null {
  const { buf } = state;
  if (!buf.startsWith("*")) return null;
  let eol = buf.indexOf("\r\n");
  if (eol === -1) return null;
  const count = Number(buf.slice(1, eol));
  const args: string[] = [];
  let off = eol + 2;
  for (let i = 0; i < count; i++) {
    if (buf[off] !== "$") return null;
    eol = buf.indexOf("\r\n", off);
    if (eol === -1) return null;
    const len = Number(buf.slice(off + 1, eol));
    if (buf.length < eol + 2 + len + 2) return null;
    args.push(buf.slice(eol + 2, eol + 2 + len));
    off = eol + 2 + len + 2;
  }
  state.buf = buf.slice(off);
  return args;
}

// A RESP stub that records the username each connection authenticates as
// (`HELLO 3 AUTH <user> <pass>`). It answers PING with +PONG and everything
// else with +OK.
function authRecordingServer() {
  const users: string[] = [];
  const server = Bun.listen<{ buf: string }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buf: "" };
      },
      data(socket, chunk) {
        socket.data.buf += chunk.toString("latin1");
        let args: string[] | null;
        while ((args = takeCommand(socket.data)) !== null) {
          const command = args[0].toUpperCase();
          if (command === "HELLO") {
            const auth = args.findIndex(arg => arg.toUpperCase() === "AUTH");
            users.push(auth === -1 ? "(no auth)" : args[auth + 1]);
          }
          socket.write(command === "PING" ? "+PONG\r\n" : "+OK\r\n");
        }
      },
    },
  });
  return {
    port: server.port,
    users,
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

// Builds each client with no URL argument, so the URL comes from the
// environment: REDIS_URL, then VALKEY_URL, then valkey://localhost:6379.
const fixture = /* js */ `
  import { RedisClient } from "bun";
  const url = user => "redis://" + user + ":pw@127.0.0.1:" + process.env.STUB_PORT;
  const replies = [];
  async function probe() {
    const client = new RedisClient(undefined, { autoReconnect: false, connectionTimeout: 5000 });
    try {
      replies.push(await client.send("PING", []));
    } catch (err) {
      replies.push(err.code);
    } finally {
      client.close();
    }
  }
  if (process.env.REDIS_URL) await probe();
  process.env.REDIS_URL = url("runtime1");
  await probe();
  delete process.env.REDIS_URL;
  process.env.VALKEY_URL = url("valkey1");
  await probe();
  process.env.REDIS_URL = url("runtime2");
  await probe();
  console.log(JSON.stringify(replies));
`;

async function runFixture(stubPort: number, launchEnv: Record<string, string>) {
  const env: Record<string, string | undefined> = { ...bunEnv, STUB_PORT: String(stubPort) };
  delete env.REDIS_URL;
  delete env.VALKEY_URL;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...env, ...launchEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { replies: JSON.parse(stdout.trim() || "null"), stderr, exitCode };
}

describe.concurrent("new RedisClient() with no URL", () => {
  test("reads REDIS_URL and VALKEY_URL from process.env when the client is constructed", async () => {
    using stub = authRecordingServer();
    const result = await runFixture(stub.port, { REDIS_URL: `redis://launch:pw@127.0.0.1:${stub.port}` });
    expect({ users: stub.users, ...result }).toEqual({
      users: ["launch", "runtime1", "valkey1", "runtime2"],
      replies: ["PONG", "PONG", "PONG", "PONG"],
      stderr: "",
      exitCode: 0,
    });
  });

  test("uses a REDIS_URL assigned at runtime when none was set at startup", async () => {
    using stub = authRecordingServer();
    const result = await runFixture(stub.port, {});
    expect({ users: stub.users, ...result }).toEqual({
      users: ["runtime1", "valkey1", "runtime2"],
      replies: ["PONG", "PONG", "PONG"],
      stderr: "",
      exitCode: 0,
    });
  });
});
