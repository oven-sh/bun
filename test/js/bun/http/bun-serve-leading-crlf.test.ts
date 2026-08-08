import { describe, expect, it } from "bun:test";
import { connect } from "node:net";

/* RFC 9112 2.2: "a server that is expecting to receive and parse a request-line
 * SHOULD ignore at least one empty line (CRLF) received prior to the
 * request-line." The motivating case the RFC gives is a client that sends an
 * extra CRLF after a POST body, which then sits in front of the next request
 * on the same keep-alive connection. */

describe("Bun.serve: empty line(s) before the request-line are ignored (RFC 9112 2.2)", () => {
  async function run(bytes: string) {
    const events: string[] = [];
    await using server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        events.push(`request ${req.method} ${new URL(req.url).pathname}`);
        await req.text();
        return new Response("ok");
      },
    });

    const raw = await new Promise<string>(resolve => {
      const out: Buffer[] = [];
      const sock = connect(server.port, "127.0.0.1", () => sock.end(Buffer.from(bytes, "latin1")));
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
});
