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

  it("leading CRLF followed by an invalid request-line still errors", async () => {
    // After the CRLF is skipped the remaining bytes must be judged on their own.
    // "hello world" has a non-'/' target that is not an http(s):// prefix, so the
    // server closes with a clientError instead of buffering forever.
    const { events } = await run(
      "GET /blah HTTP/1.1\r\nHost: example.org:443\r\nCookie:\r\nOrigin: http://example.org\r\n\r\n\r\nhello world",
    );
    expect(events[0]).toBe("request GET /blah");
    expect(events[1]).toMatch(/^clientError /);
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

  it("leading CRLF and request-line sent in separate writes still parses", async () => {
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

    const out: Buffer[] = [];
    const sock = connect(port, "127.0.0.1");
    sock.on("data", d => out.push(d));
    const closed = once(sock, "close");
    sock.on("error", () => {});
    await once(sock, "connect");

    // Best-effort: yield so the server may read the lone CRLF first and take the
    // shortRead/fallback path. Loopback may still coalesce; either way must parse.
    sock.write("\r\n");
    await new Promise<void>(r => setImmediate(r));
    sock.write("GET /split HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", () => sock.end());

    await closed;
    const raw = Buffer.concat(out).toString("latin1");
    expect(events).toEqual(["request GET /split"]);
    expect(raw.startsWith("HTTP/1.1 200 ")).toBe(true);
  });
});
