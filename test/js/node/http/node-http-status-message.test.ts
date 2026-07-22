/**
 * All tests in this file also run in Node.js.
 */
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";

async function rawStatusLine(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  try {
    const response = await new Promise<string>((resolve, reject) => {
      const client = connect(port, "127.0.0.1");
      let data = "";
      // latin1 so every wire byte maps to one code unit (U+0000..U+00FF).
      client.setEncoding("latin1");
      client.on("data", chunk => (data += chunk));
      client.on("error", reject);
      client.on("end", () => resolve(data));
      client.write("GET / HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
    });
    return response.split("\r\n")[0];
  } finally {
    server.close();
  }
}

describe("node:http ServerResponse statusMessage wire bytes", () => {
  test("writeHead(200, '') writes an empty reason phrase", async () => {
    const line = await rawStatusLine((req, res) => {
      res.writeHead(200, "");
      res.end("x");
    });
    expect(line).toBe("HTTP/1.1 200 ");
  });

  test("statusMessage = '' without writeHead still defaults the reason phrase", async () => {
    // Node's _implicitHeader applies `if (!statusMessage) STATUS_CODES[code]`,
    // which treats "" as unset; only an explicit writeHead(N, "") preserves it.
    const line = await rawStatusLine((req, res) => {
      res.statusMessage = "";
      res.end("x");
    });
    expect(line).toBe("HTTP/1.1 200 OK");
  });

  test("writeHead(200, obs-text) writes latin1 bytes", async () => {
    const line = await rawStatusLine((req, res) => {
      res.writeHead(200, "Ünïcödé");
      res.end("x");
    });
    const phraseBytes = [...line.slice(13)].map(c => c.charCodeAt(0));
    // Node.js writes the status line with latin1 encoding (lib/_http_outgoing.js
    // _storeHeader): one byte per JS code unit, RFC 9112 obs-text.
    expect(phraseBytes).toEqual([0xdc, 0x6e, 0xef, 0x63, 0xf6, 0x64, 0xe9]);
  });
});
