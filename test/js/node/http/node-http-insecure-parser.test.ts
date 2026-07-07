/**
 * All tests in this file should also run in Node.js.
 */
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";

type Served = { url: string; xA: unknown; cl: unknown; te: unknown; body: string };

async function runServer(insecure: boolean, rawRequest: string | readonly string[]) {
  const served: Served[] = [];
  const clientErrors: string[] = [];
  const options = insecure ? { insecureHTTPParser: true } : {};
  const srv = http.createServer(options, (req, res) => {
    let body = "";
    req.on("data", d => (body += d));
    req.on("end", () => {
      served.push({
        url: req.url!,
        xA: req.headers["x-a"],
        cl: req.headers["content-length"],
        te: req.headers["transfer-encoding"],
        body,
      });
      res.end("ok");
    });
  });
  srv.on("clientError", (err: any, socket) => {
    clientErrors.push(err.code);
    socket.destroy();
  });
  await once(srv.listen(0, "127.0.0.1"), "listening");
  try {
    const { port } = srv.address() as AddressInfo;
    const chunks = typeof rawRequest === "string" ? [rawRequest] : rawRequest;
    const response = await new Promise<string>((resolve, reject) => {
      const client = connect({ port, host: "127.0.0.1", noDelay: true });
      let out = "";
      client.setEncoding("latin1");
      client.on("data", c => (out += c));
      client.on("error", reject);
      client.on("close", () => resolve(out));
      client.on("connect", async () => {
        for (let i = 0; i < chunks.length; i++) {
          // TCP-stack yield so each chunk reaches the parser as its own read
          // and exercises the shortRead re-parse path (TCP_NODELAY is set).
          if (i > 0) await new Promise(r => setTimeout(r, 20));
          client.write(Buffer.from(chunks[i], "latin1"));
        }
      });
    });
    return { served, clientErrors, response };
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
}

describe("http.createServer insecureHTTPParser", () => {
  test.concurrent("accepts obs-fold header continuation lines", async () => {
    const raw = "GET /obsfold HTTP/1.1\r\nHost: x\r\nX-A: one\r\n two\r\n\tthree\r\nConnection: close\r\n\r\n";
    const { served, clientErrors } = await runServer(true, raw);
    expect({ served, clientErrors }).toEqual({
      served: [{ url: "/obsfold", xA: "one two\tthree", cl: undefined, te: undefined, body: "" }],
      clientErrors: [],
    });
  });

  test.concurrent("obs-fold header value survives a shortRead re-parse", async () => {
    // The obs-fold CRLF is compacted in place; splitting the request after the
    // folded header but before the terminating CRLF forces a re-parse over the
    // mutated bytes, which must yield the same value.
    const after = await runServer(true, [
      "GET /obsfold HTTP/1.1\r\nHost: x\r\nX-A: one\r\n two\r\nConnection: close\r\n",
      "\r\n",
    ]);
    expect({ served: after.served, clientErrors: after.clientErrors }).toEqual({
      served: [{ url: "/obsfold", xA: "one two", cl: undefined, te: undefined, body: "" }],
      clientErrors: [],
    });

    // Split between two folds of the same header: the parser must wait for the
    // byte after the intermediate CRLF before compacting.
    const between = await runServer(true, [
      "GET /obsfold HTTP/1.1\r\nHost: x\r\nX-A: one\r\n two\r\n",
      " three\r\nConnection: close\r\n\r\n",
    ]);
    expect({ served: between.served, clientErrors: between.clientErrors }).toEqual({
      served: [{ url: "/obsfold", xA: "one two three", cl: undefined, te: undefined, body: "" }],
      clientErrors: [],
    });
  });

  test.concurrent("tolerates Content-Length together with Transfer-Encoding: chunked", async () => {
    const raw =
      "POST /clte HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n" +
      "5\r\nhello\r\n0\r\n\r\n";
    const { served, clientErrors } = await runServer(true, raw);
    expect({ served, clientErrors }).toEqual({
      served: [{ url: "/clte", xA: undefined, cl: "5", te: "chunked", body: "hello" }],
      clientErrors: [],
    });
  });

  test.concurrent("strict parser (default) still rejects obs-fold and CL+TE", async () => {
    const obsfold = await runServer(
      false,
      "GET /obsfold HTTP/1.1\r\nHost: x\r\nX-A: one\r\n two\r\nConnection: close\r\n\r\n",
    );
    expect({ served: obsfold.served, clientErrors: obsfold.clientErrors }).toEqual({
      served: [],
      clientErrors: ["HPE_INVALID_HEADER_TOKEN"],
    });

    const clte = await runServer(
      false,
      "POST /clte HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n\r\n",
    );
    expect({ served: clte.served, clientErrors: clte.clientErrors }).toEqual({
      served: [],
      clientErrors: ["HPE_INVALID_TRANSFER_ENCODING"],
    });
  });
});
