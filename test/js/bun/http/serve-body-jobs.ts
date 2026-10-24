import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import { createConnection } from "node:net";
import { join } from "node:path";

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

/**
 * Requests `body` from serve-body-jobs-fixture.ts, which runs `probe` in the script that
 * Bun.serve runs for that body from the socket's writable callback.
 *
 * The client reads nothing until the server has written all that the socket takes, so
 * that what the server writes later, it writes from the writable callback. The client then
 * reads the response to its end, and the fixture exits.
 *
 * `order` is what the probe recorded: the order in which its callbacks ran.
 */
export async function serveBodyJobs(options: {
  body: string;
  probe: "statement" | "timer" | "store" | "turn";
  page?: string;
}) {
  const { body, probe, page = "" } = options;
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "serve-body-jobs-fixture.ts"), body, probe, page],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = proc.stderr.text();
  const stdout = lines(proc.stdout);
  const port = Number(await stdout.next());

  const socket = createConnection(port, "127.0.0.1");
  socket.pause();
  const closed = once(socket, "close");
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
  let order: string[] | undefined;
  try {
    await once(socket, "connect");
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    for (;;) {
      const line = await stdout.next();
      if (line === "backpressured") {
        socket.on("data", received);
        socket.resume();
        continue;
      }
      if (line !== undefined) order = JSON.parse(line);
      break;
    }
    await closed;
  } finally {
    socket.destroy();
  }
  proc.stdin.end();
  // A body with a declared length has that length. A chunked body ends with the last chunk.
  const declared = /^content-length: (\d+)$/im.exec(head ?? "");
  const complete = declared ? length === Number(declared[1]) : tail.toString("latin1") === "0\r\n\r\n";
  return {
    order,
    response: complete ? "complete" : "cut off",
    stderr: await stderr,
    exitCode: await proc.exited,
  };
}
