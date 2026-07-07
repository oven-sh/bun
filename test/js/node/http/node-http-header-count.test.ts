import { expect, test, describe } from "bun:test";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

function buildRequest(extraHeaders: number, trailer = "Connection: close\r\n") {
  let req = `GET / HTTP/1.1\r\nHost: x\r\n`;
  for (let i = 0; i < extraHeaders; i++) req += `X-${i}: v\r\n`;
  req += trailer;
  req += "\r\n";
  return req;
}

function rawRequest(port: number, bytes: string): Promise<string> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    const sock = net.connect(port, "127.0.0.1", () => sock.end(Buffer.from(bytes, "latin1")));
    const done = () => {
      sock.destroy();
      resolve(Buffer.concat(chunks).toString("latin1"));
    };
    sock.on("data", d => chunks.push(d));
    sock.on("close", done);
    sock.on("error", done);
  });
}

function statusLine(response: string): string {
  return response.slice(0, response.indexOf("\r\n"));
}

describe("node:http server accepts requests with many header fields", () => {
  async function probe(extraHeaders: number, trailer?: string) {
    const events: string[] = [];
    const server = http.createServer((req, res) => {
      events.push(`request rawHeaders=${req.rawHeaders.length / 2}`);
      res.end("ok");
    });
    server.on("clientError", (err: NodeJS.ErrnoException) => {
      events.push(`clientError ${err.code}`);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const response = await rawRequest(port, buildRequest(extraHeaders, trailer));
      return { status: statusLine(response), events };
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }

  // Previously rejected with 431 / HPE_HEADER_OVERFLOW once the total field
  // count reached 199. Node.js accepts these (default ceiling is 1000 fields,
  // tunable via server.maxHeadersCount) and only rejects on byte size.
  for (const n of [150, 197, 300, 900]) {
    test(`${n} extra header fields are delivered`, async () => {
      const { status, events } = await probe(n);
      expect({ status, events }).toEqual({
        status: "HTTP/1.1 200 OK",
        events: [`request rawHeaders=${n + 2}`],
      });
    });
  }

  test("fields beyond the stored limit are truncated, not rejected", async () => {
    // Host + 1100 X-N fields + Connection is ~12 KB, under the 16 KB default
    // byte limit, so only the count path is exercised.
    const { status, events } = await probe(1100);
    expect({ status, events }).toEqual({
      status: "HTTP/1.1 200 OK",
      events: ["request rawHeaders=1000"],
    });
  });

  test("Content-Length past the stored limit is rejected (request smuggling guard)", async () => {
    const { status, events } = await probe(1100, "Content-Length: 5\r\nConnection: close\r\n");
    expect({ status, events }).toEqual({
      status: "HTTP/1.1 400 Bad Request",
      events: ["clientError HPE_INTERNAL"],
    });
  });

  test("Transfer-Encoding past the stored limit is rejected (request smuggling guard)", async () => {
    const { status, events } = await probe(1100, "Transfer-Encoding: chunked\r\nConnection: close\r\n");
    expect({ status, events }).toEqual({
      status: "HTTP/1.1 400 Bad Request",
      events: ["clientError HPE_INTERNAL"],
    });
  });

  test("byte-size limit still rejects with 431", async () => {
    const events: string[] = [];
    const server = http.createServer({ maxHeaderSize: 2048 }, (req, res) => {
      events.push("request");
      res.end("ok");
    });
    server.on("clientError", (err: NodeJS.ErrnoException) => {
      events.push(`clientError ${err.code}`);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      // 300 tiny fields are ~3 KB of header bytes: the 2 KB byte limit fires
      // before the count path is ever reached.
      const response = await rawRequest(port, buildRequest(300));
      expect({ status: statusLine(response), events }).toEqual({
        status: "HTTP/1.1 431 Request Header Fields Too Large",
        events: ["clientError HPE_HEADER_OVERFLOW"],
      });
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});

describe("Bun.serve accepts requests with many header fields", () => {
  for (const n of [197, 300, 900]) {
    test(`${n} extra header fields are delivered`, async () => {
      let seen: Record<string, string | null> = {};
      await using server = Bun.serve({
        port: 0,
        fetch(req) {
          seen = { first: req.headers.get("x-0"), last: req.headers.get(`x-${n - 1}`) };
          return new Response("ok");
        },
      });
      const response = await rawRequest(server.port, buildRequest(n));
      expect({ status: statusLine(response), seen }).toEqual({
        status: "HTTP/1.1 200 OK",
        seen: { first: "v", last: "v" },
      });
    });
  }

  test("fields beyond the stored limit are truncated, not rejected", async () => {
    let seen: Record<string, string | null> = {};
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        seen = { first: req.headers.get("x-0"), dropped: req.headers.get("x-1099") };
        return new Response("ok");
      },
    });
    const response = await rawRequest(server.port, buildRequest(1100));
    expect({ status: statusLine(response), seen }).toEqual({
      status: "HTTP/1.1 200 OK",
      seen: { first: "v", dropped: null },
    });
  });
});
