import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import { createConnection } from "node:net";
import { join } from "node:path";
import { baseHeaders, frame, RawH2, T } from "./serve-http2-helpers";

// The lines a process prints, one per `next()`. Undefined once the stream has ended.
function lines(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let text = "";
  return {
    async next() {
      for (;;) {
        const end = text.indexOf("\n");
        if (end !== -1) {
          const line = text.slice(0, end);
          text = text.slice(end + 1);
          return line;
        }
        const { value, done } = await reader.read();
        if (done) return undefined;
        text += decoder.decode(value, { stream: true });
      }
    },
  };
}

type Lines = ReturnType<typeof lines>;
type Outcome = { order: string[] | undefined; response: "complete" | "cut off" };

// What the fixture prints after its port: "backpressured", then what the probe recorded.
async function probeOrder(stdout: Lines, release: () => void) {
  for (;;) {
    const line = await stdout.next();
    if (line !== "backpressured") return line === undefined ? undefined : (JSON.parse(line) as string[]);
    release();
  }
}

// Over HTTP/1.1 the client reads nothing until the server has filled the socket.
async function overHttp1(port: number, stdout: Lines): Promise<Outcome> {
  const socket = createConnection(port, "127.0.0.1");
  socket.pause();
  // A response that the server cuts off can end in a reset.
  const closed = new Promise<void>(resolve => socket.on("error", () => {}).on("close", () => resolve()));
  // The response: its head, then the length and the last bytes of what follows.
  let head: string | undefined;
  let start = Buffer.alloc(0);
  let length = 0;
  let tail = Buffer.alloc(0);
  function received(bytes: Buffer) {
    if (head === undefined) {
      start = Buffer.concat([start, bytes]);
      const end = start.indexOf("\r\n\r\n");
      if (end === -1) return;
      head = start.toString("latin1", 0, end);
      bytes = start.subarray(end + 4);
    }
    length += bytes.length;
    tail = Buffer.concat([tail, bytes.subarray(-5)]).subarray(-5);
  }
  try {
    await once(socket, "connect");
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    const order = await probeOrder(stdout, () => socket.on("data", received).resume());
    await closed;
    // A body with a declared length has that length. A chunked body ends with the last chunk.
    const declared = /^content-length: (\d+)$/im.exec(head ?? "");
    const complete = declared ? length === Number(declared[1]) : tail.toString("latin1") === "0\r\n\r\n";
    return { order, response: complete ? "complete" : "cut off" };
  } finally {
    socket.destroy();
  }
}

// Over HTTP/2 the client opens no more than the initial flow-control window until the
// dispatch of the request has returned.
async function overHttp2(port: number, stdout: Lines): Promise<Outcome> {
  const client = await RawH2.connect(port, false);
  try {
    client.headers(1, baseHeaders("/"));
    const order = await probeOrder(stdout, () => {
      const increment = Buffer.alloc(4);
      increment.writeUInt32BE(0x7fff0000);
      client.write(frame(T.WINDOW_UPDATE, 0, 0, increment));
      client.write(frame(T.WINDOW_UPDATE, 0, 1, increment));
    });
    const ended = await client.body(1).then(
      () => true,
      () => false,
    );
    return { order, response: ended ? "complete" : "cut off" };
  } finally {
    client.close();
  }
}

/**
 * Requests `body` from serve-body-jobs-fixture.ts, which runs `probe` in the script that
 * Bun.serve runs for that body from the socket's writable callback.
 *
 * The client takes nothing until the dispatch of the request has written all that the
 * transport takes, so that what the server writes later, it writes from the writable
 * callback. The client then reads the response to its end, and the fixture exits.
 *
 * `order` is what the probe recorded: the order in which its callbacks ran.
 */
export async function serveBodyJobs(options: {
  body: string;
  probe: "statement" | "timer" | "store" | "turn";
  page?: string;
  http2?: boolean;
}) {
  const { body, probe, page = "", http2 = false } = options;
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "serve-body-jobs-fixture.ts"), body, probe, page, http2 ? "h2" : ""],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = proc.stderr.text();
  const stdout = lines(proc.stdout);
  const port = Number(await stdout.next());
  // A fixture that printed no port has failed: the caller's assertion shows its stderr.
  const outcome: Outcome = port
    ? await (http2 ? overHttp2 : overHttp1)(port, stdout)
    : { order: undefined, response: "cut off" };
  try {
    await proc.stdin.end();
  } catch {
    // The fixture is gone already.
  }
  return { ...outcome, stderr: await stderr, exitCode: await proc.exited };
}
