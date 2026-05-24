// https://github.com/oven-sh/bun/issues/31317
import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { connect, type AddressInfo } from "node:net";

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

// Reads the raw HTTP response off the wire so we can count header lines —
// going through `fetch()` would run the response through Bun's HTTP client,
// which has its own header-joining behavior and would mask a server-side
// multi-value regression.
function readRawResponse(port: number): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const sock = connect(port, "127.0.0.1", () => {
    sock.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  });
  let buf = "";
  sock.on("data", d => (buf += d));
  sock.on("end", () => resolve(buf));
  sock.on("error", reject);
  return promise;
}

test("writeHead(status, { name: [array] }) emits one wire line per value", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "X-Multi": ["a", "b", "c"] });
    res.end("hi");
  });
  const port = await listen(server);
  try {
    const raw = await readRawResponse(port);
    expect((raw.match(/^X-Multi:/gim) ?? []).length).toBe(3);
    expect(raw).toMatch(/X-Multi: a\r\n/);
    expect(raw).toMatch(/X-Multi: b\r\n/);
    expect(raw).toMatch(/X-Multi: c\r\n/);
  } finally {
    server.close();
  }
});

test("setHeader(name, [array]) emits one wire line per value", async () => {
  const server = createServer((_req, res) => {
    res.setHeader("X-Multi", ["a", "b", "c"]);
    res.end("hi");
  });
  const port = await listen(server);
  try {
    const raw = await readRawResponse(port);
    expect((raw.match(/^X-Multi:/gim) ?? []).length).toBe(3);
  } finally {
    server.close();
  }
});

test("repeated appendHeader emits one wire line per call", async () => {
  const server = createServer((_req, res) => {
    res.appendHeader("X-Multi", "a");
    res.appendHeader("X-Multi", "b");
    res.appendHeader("X-Multi", "c");
    res.end("hi");
  });
  const port = await listen(server);
  try {
    const raw = await readRawResponse(port);
    expect((raw.match(/^X-Multi:/gim) ?? []).length).toBe(3);
  } finally {
    server.close();
  }
});

test("setHeader after appendHeader clears prior values", async () => {
  const server = createServer((_req, res) => {
    res.appendHeader("X-Multi", "a");
    res.appendHeader("X-Multi", "b");
    res.setHeader("X-Multi", "only");
    res.end("hi");
  });
  const port = await listen(server);
  try {
    const raw = await readRawResponse(port);
    expect((raw.match(/^X-Multi:/gim) ?? []).length).toBe(1);
    expect(raw).toMatch(/X-Multi: only\r\n/);
  } finally {
    server.close();
  }
});

test("removeHeader drops every appended value", async () => {
  const server = createServer((_req, res) => {
    res.appendHeader("X-Multi", "a");
    res.appendHeader("X-Multi", "b");
    res.appendHeader("X-Multi", "c");
    res.removeHeader("X-Multi");
    res.end("hi");
  });
  const port = await listen(server);
  try {
    const raw = await readRawResponse(port);
    expect((raw.match(/^X-Multi:/gim) ?? []).length).toBe(0);
  } finally {
    server.close();
  }
});

// Node returns `getHeader` as an array after repeated `appendHeader`, Bun
// returns the `", "`-joined string (WHATWG `Headers.get()` semantics).
// Assert on the wire-format side-effect instead so this test exercises the
// round-trip in both runtimes.
test("repeated appendHeader + getHeader preserves every value", async () => {
  const { promise, resolve } = Promise.withResolvers<string | string[] | number | undefined>();
  const server = createServer((_req, res) => {
    res.appendHeader("X-Multi", "a");
    res.appendHeader("X-Multi", "b");
    res.appendHeader("X-Multi", "c");
    resolve(res.getHeader("X-Multi"));
    res.end("hi");
  });
  const port = await listen(server);
  try {
    const raw = await readRawResponse(port);
    const header = await promise;
    // Flatten whichever shape the runtime returns.
    const joined = Array.isArray(header) ? header.join(", ") : String(header);
    expect(joined).toBe("a, b, c");
    expect((raw.match(/^X-Multi:/gim) ?? []).length).toBe(3);
  } finally {
    server.close();
  }
});

test("Set-Cookie array still produces separate wire lines", async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Set-Cookie", ["a=1", "b=2", "c=3"]);
    res.end("hi");
  });
  const port = await listen(server);
  try {
    const raw = await readRawResponse(port);
    expect((raw.match(/^Set-Cookie:/gim) ?? []).length).toBe(3);
  } finally {
    server.close();
  }
});
