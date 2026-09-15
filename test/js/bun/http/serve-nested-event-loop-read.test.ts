import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { once } from "node:events";
import * as net from "node:net";
import path from "node:path";

// A request handler can run the event loop inside itself (here: Bun.build
// waiting for an async plugin setup()). A read dispatched for the same
// connection inside that run used to be parsed right away, which reallocated
// the parser's buffer for the connection and freed the bytes the live
// request's url and headers point into.

const fixture = path.join(import.meta.dir, "serve-nested-event-loop-read-fixture.ts");

/** Spawns the fixture and returns a reader for the marker lines it prints. */
function spawnFixture(kind: string, dir: string) {
  const proc = Bun.spawn({
    cmd: [bunExe(), fixture, kind, path.join(dir, "entry.js")],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  let pending = "";
  const lines = proc.stdout.getReader();
  async function waitForLine(prefix: string): Promise<string> {
    while (true) {
      const newline = pending.indexOf("\n");
      if (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.startsWith(prefix)) {
          return line.slice(prefix.length);
        }
        continue;
      }
      const { done, value } = await lines.read();
      if (done) {
        throw new Error(`the server exited before it printed "${prefix}": ${await proc.stderr.text()}`);
      }
      pending += Buffer.from(value).toString("latin1");
    }
  }
  return { proc, waitForLine };
}

describe.each(["bun", "node"])("%s server", kind => {
  test.concurrent("a request handler that runs the event loop keeps its url and headers", async () => {
    using dir = tempDir(`serve-nested-event-loop-read-${kind}`, { "entry.js": "export default 1;" });
    const { proc, waitForLine } = spawnFixture(kind, String(dir));
    await using _ = proc;

    const port = Number(await waitForLine("port "));
    const pad = Buffer.alloc(40, "p").toString();
    const head = `GET /held HTTP/1.1\r\nHost: held.example\r\nAuthorization: Bearer au-${pad}\r\nX-Pad: ${pad}\r\n\r\n`;
    // Bun.serve reports the absolute url, node:http the request target.
    const heldUrl = kind === "node" ? "/held" : "http://held.example/held";
    const secondUrl = kind === "node" ? "/second" : "http://second.example/second";

    const socket = net.connect(port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.setNoDelay(true);

      let received = "";
      const answered = new Promise<void>(resolve => {
        socket.on("data", chunk => {
          received += chunk.toString("latin1");
          if (received.includes("r2")) resolve();
        });
        socket.on("close", () => resolve());
      });

      // Send the head of the held request in two pieces. The barrier request in
      // between is answered only after the server has read the first piece, so
      // the head has to be parsed out of the connection's parse buffer.
      socket.write(head.slice(0, 10));
      expect(await (await fetch(`http://127.0.0.1:${port}/barrier`)).text()).toBe("barrier");
      socket.write(head.slice(10));

      // The handler is now inside the nested run of the event loop. This read
      // is dispatched for the same connection while it runs.
      await waitForLine("holding");
      socket.write(`GET /second HTTP/1.1\r\nHost: second.example\r\n\r\n`);

      expect(JSON.parse(await waitForLine("result "))).toEqual({
        ticked: true,
        url: heldUrl,
        authorization: `Bearer au-${pad}`,
      });

      // The read that arrived during the nested run is parsed once the handler
      // is done with the connection's parse state, not dropped.
      expect(JSON.parse(await waitForLine("again "))).toBe(secondUrl);
      await answered;
      expect(received).toContain("r1");
      expect(received).toContain("r2");
    } finally {
      socket.destroy();
    }
  });
});

// The handler starts as soon as the head is parsed, so a body can still be
// arriving while it runs the event loop. The first read holds the head and the
// start of the body. The parse delivers that start only after the handler
// returns, so a read parsed inside the handler put the END of the body first.
test.concurrent("a request body that arrives while the handler runs the event loop stays in order", async () => {
  using dir = tempDir("serve-nested-event-loop-read-body", { "entry.js": "export default 1;" });
  const { proc, waitForLine } = spawnFixture("body", String(dir));
  await using _ = proc;

  const port = Number(await waitForLine("port "));
  const start = Buffer.alloc(20, "A").toString();
  const end = Buffer.alloc(20, "B").toString();

  const socket = net.connect(port, "127.0.0.1");
  try {
    socket.on("error", () => {});
    await once(socket, "connect");
    socket.setNoDelay(true);

    socket.write(
      `POST /upload HTTP/1.1\r\nHost: upload.example\r\nContent-Length: ${start.length + end.length}\r\n\r\n${start}`,
    );
    await waitForLine("holding");
    socket.write(end);

    expect(JSON.parse(await waitForLine("result "))).toEqual({ ticked: true, body: start + end });
  } finally {
    socket.destroy();
  }
});

// The read that arrives during the nested run stops the connection's reads
// until the handler is done. A handler that upgrades takes the socket out of
// HTTP, and the WebSocket it becomes has to read again.
test.concurrent("a WebSocket upgraded by a handler that ran the event loop still receives frames", async () => {
  using dir = tempDir("serve-nested-event-loop-read-upgrade", { "entry.js": "export default 1;" });
  const { proc, waitForLine } = spawnFixture("upgrade", String(dir));
  await using _ = proc;

  const port = Number(await waitForLine("port "));

  /** A masked client-to-server text frame (payload under 126 bytes). */
  function textFrame(text: string): Buffer {
    const payload = Buffer.from(text);
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const frame = Buffer.alloc(6 + payload.length);
    frame[0] = 0x81;
    frame[1] = 0x80 | payload.length;
    mask.copy(frame, 2);
    for (let i = 0; i < payload.length; i++) {
      frame[6 + i] = payload[i] ^ mask[i % 4];
    }
    return frame;
  }

  const socket = net.connect(port, "127.0.0.1");
  try {
    socket.on("error", () => {});
    await once(socket, "connect");
    socket.setNoDelay(true);

    let received = "";
    const switched = new Promise<void>((resolve, reject) => {
      socket.on("data", chunk => {
        received += chunk.toString("latin1");
        if (received.includes("\r\n\r\n")) resolve();
      });
      socket.on("close", () => reject(new Error(`the server closed the connection: ${JSON.stringify(received)}`)));
    });

    socket.write(
      "GET /ws HTTP/1.1\r\nHost: ws.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
    );

    // The handler is inside the nested run of the event loop and has not
    // upgraded yet. These bytes are not part of the WebSocket stream (a client
    // has to wait for the 101 first), they only make the server read from the
    // connection while its handler runs.
    await waitForLine("holding");
    socket.write(textFrame("early"));

    expect(JSON.parse(await waitForLine("upgrading "))).toEqual({ ticked: true });
    await switched;
    expect(received).toStartWith("HTTP/1.1 101 ");

    socket.write(textFrame("late"));
    let message: string;
    do {
      message = JSON.parse(await waitForLine("message "));
    } while (message !== "late");
    expect(message).toBe("late");
  } finally {
    socket.destroy();
  }
});
