import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer as createNetServer } from "node:net";

describe("req.destroy() mid-body reports the response as aborted", () => {
  // RFC 9112 6.3: without Content-Length or Transfer-Encoding the body is
  // framed by connection close. Destroying the request locally must surface as
  // 'aborted' + ECONNRESET (the download is truncated), never a clean 'end'.
  it.each([
    ["EOF-delimited", "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\npart1-", true],
    ["chunked", "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\npart1-\r\n", false],
  ] as const)("%s", async (_name, responseBytes, expectedComplete) => {
    const server = createNetServer(s => {
      s.on("error", () => {});
      s.on("data", () => {
        try {
          s.write(responseBytes);
        } catch {}
      });
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;

      const { promise, resolve, reject } = Promise.withResolvers<{ events: string[]; complete: boolean }>();
      const req = request({ host: "127.0.0.1", port }, res => {
        const events: string[] = [];
        res.on("data", () => {
          events.push("data");
          req.destroy();
        });
        res.on("end", () => events.push("end"));
        res.on("aborted", () => events.push("aborted"));
        res.on("error", (e: NodeJS.ErrnoException) => events.push(`error:${e.code}`));
        res.on("close", () => resolve({ events, complete: res.complete }));
      });
      req.on("error", reject);
      req.end();

      const { events, complete } = await promise;
      expect({ events, complete }).toEqual({
        events: ["data", "aborted", "error:ECONNRESET"],
        complete: expectedComplete,
      });
    } finally {
      server.close();
    }
  });
});
