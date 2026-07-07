/**
 * All tests in this file also run in Node.js.
 */
import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";

describe("RFC 9112 2.2: empty line(s) before the request-line are ignored", () => {
  async function run(bytes: string) {
    const events: string[] = [];
    await using server = createServer((req, res) => {
      events.push(`request ${req.method} ${req.url}`);
      res.end("ok");
    });
    server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
      events.push(`clientError ${err.code}`);
      socket.destroy();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const raw = await new Promise<string>(resolve => {
      const out: Buffer[] = [];
      const sock = connect(port, "127.0.0.1", () => sock.end(Buffer.from(bytes, "latin1")));
      const done = () => {
        sock.destroy();
        resolve(Buffer.concat(out).toString("latin1"));
      };
      sock.on("data", d => out.push(d));
      sock.on("close", done);
      sock.on("error", done);
    });
    const statuses = (raw.match(/HTTP\/1\.[01] (\d{3})/g) ?? []).map(m => m.slice(-3));
    return { events, statuses };
  }

  it.each([
    ["one CRLF", "\r\n"],
    ["one bare LF", "\n"],
    ["multiple CRLF", "\r\n\r\n\r\n"],
  ])("leading %s before a single request", async (_, prefix) => {
    const { events, statuses } = await run(prefix + "GET /a HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    expect({ events, statuses }).toEqual({ events: ["request GET /a"], statuses: ["200"] });
  });

  it("stray CRLF after a POST body on a keep-alive connection", async () => {
    // The RFC's motivating case: some clients send an extra CRLF after a POST body,
    // which lands in front of the next pipelined request on the same connection.
    const { events, statuses } = await run(
      "POST /a HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\nhi" +
        "\r\n" +
        "GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    );
    expect({ events, statuses }).toEqual({
      events: ["request POST /a", "request GET /b"],
      statuses: ["200", "200"],
    });
  });

  it("a request-line split across writes with a leading CRLF still parses", async () => {
    const events: string[] = [];
    await using server = createServer((req, res) => {
      events.push(`request ${req.method} ${req.url}`);
      res.end("ok");
    });
    server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
      events.push(`clientError ${err.code}`);
      socket.destroy();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const raw = await new Promise<string>((resolve, reject) => {
      const out: Buffer[] = [];
      const sock = connect(port, "127.0.0.1", () => {
        // The CRLF arrives in its own packet, then the request follows.
        sock.write("\r\n");
        sock.write("GET /split HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", () => sock.end());
      });
      sock.on("data", d => out.push(d));
      sock.on("close", () => resolve(Buffer.concat(out).toString("latin1")));
      sock.on("error", reject);
    });
    expect(events).toEqual(["request GET /split"]);
    expect(raw.startsWith("HTTP/1.1 200 ")).toBe(true);
  });
});
