import { RedisClient, type TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";

const CRLF = "\r\n";
const bulk = (s: string) => `$${Buffer.byteLength(s)}${CRLF}${s}${CRLF}`;
// Minimal RESP3 HELLO reply so the client enters the Connected state.
const HELLO = `%1${CRLF}${bulk("proto")}:3${CRLF}`;

const SUBSCRIPTION_COMMANDS = [
  "SUBSCRIBE",
  "PSUBSCRIBE",
  "SSUBSCRIBE",
  "UNSUBSCRIBE",
  "PUNSUBSCRIBE",
  "SUNSUBSCRIBE",
] as const;

/** Split `buf` into the complete `*N\r\n($len\r\n...\r\n){N}` command frames it holds. */
function parseFrames(buf: Buffer): { frames: string[][]; rest: Buffer } {
  const frames: string[][] = [];
  for (;;) {
    if (buf.length === 0 || buf[0] !== 0x2a /* '*' */) break;
    const headerEnd = buf.indexOf(CRLF);
    if (headerEnd < 0) break;
    const argc = parseInt(buf.subarray(1, headerEnd).toString("latin1"), 10);
    let pos = headerEnd + 2;
    const fields: string[] = [];
    for (let i = 0; i < argc; i++) {
      const lenEnd = buf.indexOf(CRLF, pos);
      if (lenEnd < 0 || buf[pos] !== 0x24 /* '$' */) return { frames, rest: buf };
      const len = parseInt(buf.subarray(pos + 1, lenEnd).toString("latin1"), 10);
      const next = lenEnd + 2 + len + 2;
      if (next > buf.length) return { frames, rest: buf };
      fields.push(buf.subarray(lenEnd + 2, lenEnd + 2 + len).toString("latin1"));
      pos = next;
    }
    frames.push(fields);
    buf = buf.subarray(pos);
  }
  return { frames, rest: buf };
}

function reply([command, target = ""]: string[]): string {
  const upper = command.toUpperCase();
  if (upper === "HELLO") return HELLO;
  if (upper === "PING") return `+PONG${CRLF}`;
  if ((SUBSCRIPTION_COMMANDS as readonly string[]).includes(upper)) {
    // Servers confirm each (un)subscribe with a push frame named after the
    // command: >3 <command> <channel or pattern> <subscription count>.
    const count = upper.includes("UNSUBSCRIBE") ? 0 : 1;
    return `>3${CRLF}${bulk(command.toLowerCase())}${bulk(target)}:${count}${CRLF}`;
  }
  return `+OK${CRLF}`;
}

/**
 * Mock server that logs the order in which commands arrive (`> CMD`) and
 * replies go out (`< CMD`). Every complete frame in a socket read is logged
 * before any of them is answered, so two commands the client flushed as one
 * batch show up as `> A`, `> B`, `< A`, `< B`, while a command the client held
 * back until A's reply arrived shows up as `> A`, `< A`, `> B`, `< B`.
 */
function listen(log: string[]): TCPSocketListener<Buffer> {
  return Bun.listen<Buffer>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = Buffer.alloc(0);
      },
      error() {},
      close() {},
      data(socket, chunk) {
        const { frames, rest } = parseFrames(Buffer.concat([socket.data, chunk]));
        socket.data = rest;
        for (const frame of frames) log.push(`> ${frame[0]}`);
        for (const frame of frames) {
          socket.write(reply(frame));
          log.push(`< ${frame[0]}`);
        }
      },
    },
  });
}

/**
 * Connects a client, puts it in subscriber mode (the state an unsubscribe is
 * normally issued from), then issues a pipelinable PING and `issue` in the
 * same tick. Returns the server's log for those two commands and whatever
 * `issue` resolved with.
 */
async function issueBehindPing(issue: (client: RedisClient) => Promise<unknown>) {
  const log: string[] = [];
  const server = listen(log);
  const client = new RedisClient(`redis://127.0.0.1:${server.port}`, { autoReconnect: false });
  client.onconnect = client.onclose = () => {};
  try {
    await client.connect();
    expect(await client.psubscribe("setup.*")).toEqual({ type: "psubscribe", data: ["setup.*", 1] });
    expect(log).toEqual(["> HELLO", "< HELLO", "> PSUBSCRIBE", "< PSUBSCRIBE"]);
    log.length = 0;

    const [pong, acked] = await Promise.all([client.send("PING", []), issue(client)]);
    expect(pong).toBe("PONG");
    return { log, acked };
  } finally {
    client.close();
    server.stop(true);
  }
}

describe.concurrent("RedisClient auto-pipelining", () => {
  test("pipelinable commands issued in the same tick are flushed as one batch", async () => {
    const { log, acked } = await issueBehindPing(client => client.send("PING", []));
    expect(log).toEqual(["> PING", "> PING", "< PING", "< PING"]);
    expect(acked).toBe("PONG");
  });

  test("punsubscribe() is held back until the commands ahead of it are answered", async () => {
    const { log, acked } = await issueBehindPing(client => client.punsubscribe("news.*"));
    expect(log).toEqual(["> PING", "< PING", "> PUNSUBSCRIBE", "< PUNSUBSCRIBE"]);
    expect(acked).toEqual({ type: "punsubscribe", data: ["news.*", 0] });
  });

  test("psubscribe() is held back until the commands ahead of it are answered", async () => {
    const { log, acked } = await issueBehindPing(client => client.psubscribe("news.*"));
    expect(log).toEqual(["> PING", "< PING", "> PSUBSCRIBE", "< PSUBSCRIBE"]);
    expect(acked).toEqual({ type: "psubscribe", data: ["news.*", 1] });
  });

  // send() forwards the command name as spelled by the caller, and the server
  // accepts any casing, so the client has to recognize every spelling.
  const rawSpellings = SUBSCRIPTION_COMMANDS.flatMap(command => [command, command.toLowerCase()]);

  test.each(rawSpellings)('send("%s") is held back until the commands ahead of it are answered', async command => {
    const { log } = await issueBehindPing(client => client.send(command, ["target"]));
    expect(log).toEqual(["> PING", "< PING", `> ${command}`, `< ${command}`]);
  });
});
