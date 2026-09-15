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
describe.each(["bun", "node"])("%s server", kind => {
  test("a request handler that runs the event loop keeps its url and headers", async () => {
    using dir = tempDir(`serve-nested-event-loop-read-${kind}`, { "entry.js": "export default 1;" });
    const fixture = path.join(import.meta.dir, "serve-nested-event-loop-read-fixture.ts");

    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, kind, path.join(String(dir), "entry.js")],
      env: bunEnv,
      cwd: String(dir),
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
            return line;
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

    const port = Number((await waitForLine("port ")).slice("port ".length));
    const pad = "p".repeat(40);
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

      const result = JSON.parse((await waitForLine("result ")).slice("result ".length));
      expect(result).toEqual({
        ticked: true,
        url: heldUrl,
        authorization: `Bearer au-${pad}`,
      });

      // The read that arrived during the nested run is parsed once the handler
      // is done with the connection's parse state, not dropped.
      expect(await waitForLine("again ")).toBe(`again ${JSON.stringify(secondUrl)}`);
      await answered;
      expect(received).toContain("r1");
      expect(received).toContain("r2");
    } finally {
      socket.destroy();
    }
  });
});
