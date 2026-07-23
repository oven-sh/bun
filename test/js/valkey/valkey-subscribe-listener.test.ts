import { RedisClient, type SocketHandler, type TCPSocketListener } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A scripted RESP3 server: it frames the RESP arrays the client sends and hands each
// complete command to `reply`, which writes back whatever the test wants. No real redis.

const bulk = (s: string) => `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
const push = (...parts: string[]) => `>${parts.length}\r\n${parts.join("")}`;
const pushSubscribe = (channel: string, count: number) => push(bulk("subscribe"), bulk(channel), `:${count}\r\n`);
const pushMessage = (channel: string, message: string) => push(bulk("message"), bulk(channel), bulk(message));

const HELLO_REPLY = `%3\r\n${bulk("server")}${bulk("redis")}${bulk("version")}${bulk("7.2.0")}${bulk("proto")}:3\r\n`;

/** Consume one complete RESP array of bulk strings from the front of `buf`. */
function parseCommand(buf: Buffer): { args: string[]; consumed: number } | null {
  if (buf.length < 4 || buf[0] !== 0x2a /* '*' */) return null;
  let eol = buf.indexOf("\r\n");
  if (eol < 0) return null;
  const count = parseInt(buf.subarray(1, eol).toString("latin1"), 10);
  let off = eol + 2;
  const args: string[] = [];
  for (let i = 0; i < count; i++) {
    if (off >= buf.length || buf[off] !== 0x24 /* '$' */) return null;
    eol = buf.indexOf("\r\n", off);
    if (eol < 0) return null;
    const len = parseInt(buf.subarray(off + 1, eol).toString("latin1"), 10);
    const start = eol + 2;
    if (start + len + 2 > buf.length) return null;
    args.push(buf.subarray(start, start + len).toString("latin1"));
    off = start + len + 2;
  }
  return { args, consumed: off };
}

type Reply = (command: string, args: string[], write: (resp: string) => void) => void;

function scriptedRedis(reply: Reply): TCPSocketListener {
  const buffers = new WeakMap<Parameters<SocketHandler["data"]>[0], Buffer>();
  return Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        buffers.set(socket, Buffer.alloc(0));
      },
      data(socket, chunk) {
        let buf = Buffer.concat([buffers.get(socket)!, chunk]);
        let frame: ReturnType<typeof parseCommand>;
        while ((frame = parseCommand(buf))) {
          buf = buf.subarray(frame.consumed);
          reply(frame.args[0].toUpperCase(), frame.args.slice(1), resp => socket.write(resp));
        }
        buffers.set(socket, buf);
      },
      error() {},
      close() {},
    },
  });
}

/** Replies to HELLO, confirms every SUBSCRIBE, and publishes one message per channel. */
function confirmingRedis(): TCPSocketListener {
  return scriptedRedis((command, args, write) => {
    if (command === "HELLO") return write(HELLO_REPLY);
    if (command !== "SUBSCRIBE") return;
    for (const [i, channel] of args.entries()) write(pushSubscribe(channel, i + 1));
    for (const channel of args) write(pushMessage(channel, "hi"));
  });
}

test.concurrent("a subscribe() rejected before it is sent does not register its listener", async () => {
  using server = confirmingRedis();

  // With the offline queue disabled the first subscribe is rejected while the connection
  // is still being established, so nothing ever reaches the server.
  const redis = new RedisClient(`redis://127.0.0.1:${server.port}`, {
    enableOfflineQueue: false,
    autoReconnect: false,
  });
  const received: string[] = [];
  const { promise: delivered, resolve: onDelivered } = Promise.withResolvers<void>();
  const listener = (message: string) => {
    received.push(message);
    onDelivered();
  };

  try {
    let rejected: Error | undefined;
    try {
      await redis.subscribe("ch", listener);
    } catch (error) {
      rejected = error as Error;
    }
    expect(rejected?.message).toBe("Connection is closed and offline queue is disabled");

    // The rejected subscribe must not have left its listener behind, or this one registers
    // it a second time and the single published message arrives twice.
    await redis.connect();
    expect(await redis.subscribe("ch", listener)).toBe(1);
    await delivered;
    expect(received).toEqual(["hi"]);
  } finally {
    redis.close();
  }
});

test.concurrent("a subscribe() abandoned by a closing connection does not register its listener", async () => {
  const { promise: sawSubscribe, resolve: onSawSubscribe } = Promise.withResolvers<void>();
  let subscribesSeen = 0;
  using server = scriptedRedis((command, args, write) => {
    if (command === "HELLO") return write(HELLO_REPLY);
    if (command !== "SUBSCRIBE") return;
    // Leave the first SUBSCRIBE on the wire, unanswered.
    if (subscribesSeen++ === 0) return void onSawSubscribe();
    write(pushSubscribe(args[0], 1));
    write(pushMessage(args[0], "hi"));
  });

  const redis = new RedisClient(`redis://127.0.0.1:${server.port}`, { autoReconnect: false });
  const received: string[] = [];
  const { promise: delivered, resolve: onDelivered } = Promise.withResolvers<void>();
  const listener = (message: string) => {
    received.push(message);
    onDelivered();
  };

  try {
    const pending = redis.subscribe("ch", listener);
    await sawSubscribe;
    redis.close();

    let rejected: Error | undefined;
    try {
      await pending;
    } catch (error) {
      rejected = error as Error;
    }
    expect(rejected?.message).toBe("Connection closed");

    // Same as above: the SUBSCRIBE never got its confirmation, so it must not have left a
    // listener behind for the next one to duplicate.
    await redis.connect();
    expect(await redis.subscribe("ch", listener)).toBe(1);
    await delivered;
    expect(received).toEqual(["hi"]);
  } finally {
    redis.close();
  }
});

test.concurrent("a subscribe() rejected before it is sent does not keep the event loop alive", async () => {
  using server = confirmingRedis();

  // The client is deliberately never closed: it holds no subscription and no pending
  // command once the subscribe is rejected, so the process must exit on its own. The
  // unref'd timer only fires if something is still holding the loop open.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const redis = new Bun.RedisClient("redis://127.0.0.1:${server.port}", {
          enableOfflineQueue: false,
          autoReconnect: false,
        });
        setTimeout(() => { console.log("event loop pinned"); process.exit(7); }, 2500).unref();
        try {
          await redis.subscribe("ch", () => {});
          console.log("unexpectedly resolved");
        } catch (e) {
          console.log("rejected:", e.message);
        }
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "rejected: Connection is closed and offline queue is disabled",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test.concurrent("mutating the channel array after subscribe() does not change what gets registered", async () => {
  using server = confirmingRedis();

  const redis = new RedisClient(`redis://127.0.0.1:${server.port}`, { autoReconnect: false });
  const channels = ["a"];
  const { promise: delivered, resolve: onDelivered } = Promise.withResolvers<string>();

  try {
    const subscribed = redis.subscribe(channels, onDelivered);
    channels[0] = "b";
    expect(await subscribed).toBe(1);

    // The listener belongs to "a", the channel that was actually sent to the server.
    expect(await delivered).toBe("hi");
  } finally {
    redis.close();
  }
});
