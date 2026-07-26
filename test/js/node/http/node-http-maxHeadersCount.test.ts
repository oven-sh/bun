import { expect, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";

// Sends a raw HTTP/1.1 request with `extra` additional x-N header lines
// (plus Host and Connection: close) and resolves to { status, body }.
function rawRequest(port: number, extra: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1");
    let buf = "";
    sock.on("error", reject);
    sock.on("data", d => (buf += d));
    sock.on("close", () => {
      const statusLine = buf.slice(0, buf.indexOf("\r\n"));
      const status = Number(statusLine.split(" ")[1]) || 0;
      const body = buf.split("\r\n\r\n")[1] ?? "";
      resolve({ status, body });
    });
    sock.on("connect", () => {
      let head = `GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n`;
      for (let i = 0; i < extra; i++) head += `x-${i}: v${i}\r\n`;
      sock.write(head + "\r\n");
    });
  });
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });
}

async function withServer(
  configure: (server: http.Server) => void,
  body: (port: number) => Promise<void>,
): Promise<void> {
  const server = http.createServer((req, res) => {
    const headers = req.headers as Record<string, string>;
    res.end(JSON.stringify({ count: req.rawHeaders.length / 2, x0: headers["x-0"], xlast: headers["x-last"] }));
  });
  configure(server);
  const port = await listen(server);
  try {
    await body(port);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
}

// Host + Connection + `extra` custom lines.
const total = (extra: number) => extra + 2;

test.concurrent("server.maxHeadersCount raises the request-header field count ceiling", async () => {
  // https://github.com/oven-sh/bun/issues/6982
  await withServer(
    server => {
      server.maxHeadersCount = 400;
      // isolate the count cap from the byte-size cap
      (server as any).maxHeaderSize = 1 << 20;
    },
    async port => {
      // 300 custom headers (302 total): would 431 without a raised count cap.
      {
        const { status, body } = await rawRequest(port, 300);
        expect(status).toBe(200);
        expect(JSON.parse(body)).toEqual({ count: total(300), x0: "v0", xlast: undefined });
      }
      // exactly at the configured cap
      {
        const { status, body } = await rawRequest(port, 400 - 2);
        expect(status).toBe(200);
        expect(JSON.parse(body).count).toBe(400);
      }
      // one past the configured cap → 431
      {
        const { status } = await rawRequest(port, 400 - 1);
        expect(status).toBe(431);
      }
    },
  );
});

test.concurrent("server.maxHeadersCount preserves every header value across the overflow path", async () => {
  const server = http.createServer((req, res) => {
    const headers = req.headers as Record<string, string>;
    res.end(
      JSON.stringify({
        count: req.rawHeaders.length / 2,
        first: headers["x-0"],
        mid: headers["x-175"],
        last: headers["x-349"],
      }),
    );
  });
  server.maxHeadersCount = 400;
  (server as any).maxHeaderSize = 1 << 20;
  const port = await listen(server);
  try {
    const { status, body } = await rawRequest(port, 350);
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ count: total(350), first: "v0", mid: "v175", last: "v349" });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test.concurrent("server.maxHeadersCount near UINT32_MAX is clamped (no overflow, no giant allocation)", async () => {
  await withServer(
    server => {
      server.maxHeadersCount = 0xffff_fffe;
      (server as any).maxHeaderSize = 1 << 20;
    },
    async port => {
      const { status, body } = await rawRequest(port, 300);
      expect(status).toBe(200);
      expect(JSON.parse(body).count).toBe(total(300));
    },
  );
});

test.concurrent("default server still rejects beyond the compiled-in header-field count cap", async () => {
  await withServer(
    server => {
      (server as any).maxHeaderSize = 1 << 20;
    },
    async port => {
      {
        const { status } = await rawRequest(port, 196);
        expect(status).toBe(200);
      }
      {
        const { status } = await rawRequest(port, 250);
        expect(status).toBe(431);
      }
    },
  );
});
