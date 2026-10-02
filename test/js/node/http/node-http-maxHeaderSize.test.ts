import { proxyResponseHead } from "bun:internal-for-testing";
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, tls as tlsCert } from "harness";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "path";

test("maxHeaderSize", async () => {
  const originalMaxHeaderSize = http.maxHeaderSize;
  expect(http.maxHeaderSize).toBe(16 * 1024);
  // @ts-expect-error its a liar
  http.maxHeaderSize = 1024;
  expect(http.maxHeaderSize).toBe(1024);
  {
    using server = Bun.serve({
      port: 0,

      fetch(req) {
        return new Response(JSON.stringify(req.headers, null, 2));
      },
    });

    {
      const response = await fetch(`${server.url}/`, {
        headers: {
          "Huge": Buffer.alloc(8 * 1024, "abc").toString(),
        },
      });
      expect(response.status).toBe(431);
    }

    {
      const response = await fetch(`${server.url}/`, {
        headers: {
          "Huge": Buffer.alloc(15 * 1024, "abc").toString(),
        },
      });
      expect(response.status).toBe(431);
    }
  }
  http.maxHeaderSize = 16 * 1024;
  {
    using server = Bun.serve({
      port: 0,

      fetch(req) {
        return new Response(JSON.stringify(req.headers, null, 2));
      },
    });

    {
      const response = await fetch(`${server.url}/`, {
        headers: {
          "Huge": Buffer.alloc(15 * 1024, "abc").toString(),
        },
      });
      expect(response.status).toBe(200);
    }

    {
      const response = await fetch(`${server.url}/`, {
        headers: {
          "Huge": Buffer.alloc(17 * 1024, "abc").toString(),
        },
      });
      expect(response.status).toBe(431);
    }
  }

  http.maxHeaderSize = originalMaxHeaderSize;
});

test("server.maxHeaderSize assigned after construction is not narrowed to a smaller limit", async () => {
  // server.maxHeaderSize is a plain property and only the constructor option is validated.
  // Node casts the number to uint64_t. On x64, -1 became 2^64 - 1 here too, and the parser
  // added its framing slack to it: the limit wrapped to 863 bytes, and to 63 bytes for -800.
  // On arm64 the same happened to Infinity.
  async function statusFor(maxHeaderSize: number, headerValueLength: number) {
    const server = http.createServer((req, res) => res.end("ok"));
    server.maxHeaderSize = maxHeaderSize;
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as net.AddressInfo;
      return await new Promise<string>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        let data = "";
        socket.on("data", chunk => {
          data += chunk;
          const end = data.indexOf("\r\n");
          if (end === -1) return;
          socket.destroy();
          resolve(data.slice(0, end));
        });
        socket.on("close", () => reject(new Error(`closed before the status line: ${JSON.stringify(data)}`)));
        socket.on("error", reject);
        socket.write(`GET / HTTP/1.1\r\nHost: x\r\nX-Pad: ${Buffer.alloc(headerValueLength, "a")}\r\n\r\n`);
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }

  expect({
    "-1, 2000 bytes": await statusFor(-1, 2000),
    "-800, 100 bytes": await statusFor(-800, 100),
    "Infinity, 20000 bytes": await statusFor(Infinity, 20000),
    // Node's result for these two depends on the CPU, because the cast is undefined for them:
    // no limit on x64, the default limit on arm64. Bun uses the default limit.
    "-1, 20000 bytes": await statusFor(-1, 20000),
    "NaN, 20000 bytes": await statusFor(NaN, 20000),
    "4000, 2000 bytes": await statusFor(4000, 2000),
    "4000, 5000 bytes": await statusFor(4000, 5000),
  }).toEqual({
    "-1, 2000 bytes": "HTTP/1.1 200 OK",
    "-800, 100 bytes": "HTTP/1.1 200 OK",
    "Infinity, 20000 bytes": "HTTP/1.1 200 OK",
    "-1, 20000 bytes": "HTTP/1.1 431 Request Header Fields Too Large",
    "NaN, 20000 bytes": "HTTP/1.1 431 Request Header Fields Too Large",
    "4000, 2000 bytes": "HTTP/1.1 200 OK",
    "4000, 5000 bytes": "HTTP/1.1 431 Request Header Fields Too Large",
  });
});

test.concurrent("--max-http-header-size=1024", async () => {
  const size = 1024;
  expect(
    await bunRun(["--max-http-header-size=" + size, path.join(import.meta.dir, "max-header-size-fixture.ts")], {
      BUN_HTTP_MAX_HEADER_SIZE: String(size),
    }),
  ).toSpawn();
});

test.concurrent("--max-http-header-size=NaN", async () => {
  const { exitCode } = await bunRun([
    "--max-http-header-size=" + "NaN",
    path.join(import.meta.dir, "max-header-size-fixture.ts"),
  ]);
  expect(exitCode).not.toBe(0);
});

test.concurrent("--max-http-header-size=16*1024", async () => {
  const size = 16 * 1024;
  expect(
    await bunRun(["--max-http-header-size=" + size, path.join(import.meta.dir, "max-header-size-fixture.ts")], {
      BUN_HTTP_MAX_HEADER_SIZE: String(size),
    }),
  ).toSpawn();
});

// nodejs/node 84e367579e: the limit applies to the reply of a proxy to the CONNECT of an https request.
describe("the head of a proxy's CONNECT response", () => {
  // A complete response head of `length` bytes, with the status line of a refused CONNECT.
  function refusedHead(length: number) {
    const statusLine = "HTTP/1.1 407 Proxy Authentication Required";
    const padding = length - `${statusLine}\r\nx-pad: \r\n\r\n`.length;
    return `${statusLine}\r\nx-pad: ${Buffer.alloc(padding, "a")}\r\n\r\n`;
  }

  // A proxy that answers the CONNECT of its nth connection with `replies[n]` and ends that connection.
  async function startProxy(replies: string[]) {
    let connections = 0;
    const proxy = net.createServer(socket => {
      const reply = replies[connections++];
      socket.on("error", () => {});
      socket.once("data", () => socket.end(reply));
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    return { proxy, proxyUrl: `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}` };
  }

  test("http.maxHeaderSize is its limit", async () => {
    const { proxy, proxyUrl } = await startProxy([refusedHead(32768), refusedHead(32769)]);
    const agent = new https.Agent({ proxyEnv: { https_proxy: proxyUrl } } as any);
    // The error of one request through the proxy.
    function error() {
      const { promise, resolve } = Promise.withResolvers<string>();
      let error = "no error";
      const req = https.get({ host: "example.invalid", port: 443, agent });
      req.on("error", (err: any) => (error = `${err.code}: ${err.statusCode ?? err.message}`));
      req.on("close", () => resolve(error));
      return promise;
    }
    const original = http.maxHeaderSize;
    // @ts-expect-error Node has no setter
    http.maxHeaderSize = 32768;
    try {
      expect([await error(), await error()]).toEqual([
        "ERR_PROXY_TUNNEL: 407",
        "ERR_PROXY_TUNNEL: Proxy response headers exceeded 32768 bytes",
      ]);
    } finally {
      // @ts-expect-error Node has no setter
      http.maxHeaderSize = original;
      agent.destroy();
      proxy.close();
    }
  });

  test.concurrent.each([
    ["32768", [32768, 32769], ["407", "Proxy response headers exceeded 32768 bytes"]],
    // Bun stores 0 as 1 GiB. Node refuses every tunnel for 0.
    ["0", [65536], ["407"]],
  ])("--max-http-header-size=%s is its limit", async (size, lengths, expected) => {
    const { proxy, proxyUrl } = await startProxy(lengths.map(refusedHead));
    try {
      const script = `
        const errors = [];
        (function next() {
          const req = require("node:https").get("https://example.invalid/");
          req.on("error", err => errors.push(String(err.statusCode ?? err.message)));
          req.on("close", () => (errors.length < ${lengths.length} ? next() : console.log(JSON.stringify(errors))));
        })();
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), `--max-http-header-size=${size}`, "-e", script],
        env: {
          ...bunEnv,
          NODE_USE_ENV_PROXY: "1",
          HTTPS_PROXY: proxyUrl,
          https_proxy: undefined,
          NO_PROXY: undefined,
          no_proxy: undefined,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
        stdout: JSON.stringify(expected),
        stderr: "",
        exitCode: 0,
      });
    } finally {
      proxy.close();
    }
  });

  test("a pooled tunnel does not keep it", async () => {
    const headBytes = 512 * 1024;
    const server = https.createServer(tlsCert, (_req, res) => res.end("ok"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const serverPort = (server.address() as net.AddressInfo).port;
    const established = `HTTP/1.1 200 Connection established\r\nx-pad: ${Buffer.alloc(headBytes, "a")}\r\n\r\n`;
    const proxy = net.createServer(socket => {
      socket.on("error", () => {});
      socket.once("data", () => {
        const upstream = net.connect(serverPort, "127.0.0.1", () => {
          socket.write(established);
          upstream.pipe(socket);
          socket.pipe(upstream);
        });
        upstream.on("error", () => socket.destroy());
        socket.on("close", () => upstream.destroy());
      });
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
    const agent = new https.Agent({
      proxyEnv: { https_proxy: proxyUrl },
      keepAlive: true,
      maxHeaderSize: 2 * headBytes,
    } as any);
    function get() {
      const { promise, resolve, reject } = Promise.withResolvers<number | undefined>();
      const options = { host: "127.0.0.1", port: serverPort, agent, rejectUnauthorized: false };
      const req = https.get(options, res => res.resume().on("end", () => resolve(res.statusCode)));
      req.on("error", reject);
      return promise;
    }
    try {
      // The first tunnel loads what every later one shares.
      expect(await get()).toBe(200);
      Bun.gc(true);
      const before = heapStats().heapSize;
      const tunnels = 4;
      expect(await Promise.all(Array.from({ length: tunnels }, get))).toEqual(Array(tunnels).fill(200));
      expect(Object.values(agent.freeSockets).flat().length).toBe(tunnels);
      Bun.gc(true);
      // 3 new tunnels: each head is 512 KiB, and a kept buffer can have twice that.
      expect(heapStats().heapSize - before).toBeLessThan(((tunnels - 1) * headBytes) / 2);
    } finally {
      agent.destroy();
      proxy.close();
      server.closeAllConnections();
      server.close();
    }
  });

  const { appendHeadChunk, indexOfHeadEnd, firstLineOfHead } = proxyResponseHead;

  test("its end is where Node's concat-and-search finds it, for random chunks", () => {
    // xorshift32 with a fixed seed: the same chunks in every run.
    let state = 0x2545f491;
    function random(limit: number) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) % limit;
    }
    const alphabet = Buffer.from("\r\n\r\na ");
    const seen = { mismatches: 0, ended: 0, notEnded: 0, chunksLargerThanAllBefore: 0 };
    for (let round = 0; round < 1000; round++) {
      const bytes = Buffer.from(Array.from({ length: 1 + random(300) }, () => alphabet[random(alphabet.length)]));
      let head: Buffer | undefined;
      let node = Buffer.alloc(0);
      let received = 0;
      let ended = false;
      while (received < bytes.length && !ended) {
        const size = random(3) === 0 ? 1 + random(2 * received + 50) : 1 + random(4);
        // A chunk of its own, as a socket read makes one.
        const chunk = Buffer.from(bytes.subarray(received, received + size));
        if (received > 0 && chunk.length > received) seen.chunksLargerThanAllBefore++;
        head = appendHeadChunk(head, received, chunk);
        const index = indexOfHeadEnd(head, received, received + chunk.length);
        received += chunk.length;
        // Node: https://github.com/nodejs/node/blob/v26.10.0/lib/https.js#L251-L253
        node = Buffer.concat([node, chunk], node.length + chunk.length);
        const nodeIndex = node.indexOf("\r\n\r\n");
        if (index !== nodeIndex || !head.subarray(0, received).equals(node)) seen.mismatches++;
        ended = nodeIndex !== -1;
        if (ended && firstLineOfHead(head) !== node.subarray(0, node.indexOf("\r\n")).toString()) seen.mismatches++;
      }
      if (ended) seen.ended++;
      else seen.notEnded++;
    }
    expect(seen).toEqual({ mismatches: 0, ended: 724, notEnded: 276, chunksLargerThanAllBefore: 1253 });
  });

  test("only the received bytes are searched, from 3 bytes before the new ones", () => {
    // CRLFCRLF at 2 and at 8.
    const head = Buffer.from("ab\r\n\r\ncd\r\n\r\n");
    expect([
      indexOfHeadEnd(head, 0, 5),
      indexOfHeadEnd(head, 0, 6),
      indexOfHeadEnd(head, 5, 6),
      indexOfHeadEnd(head, 6, 12),
      indexOfHeadEnd(head, 9, 11),
    ]).toEqual([-1, 2, 2, 8, -1]);
  });

  test("its buffer is the first chunk, then doubles", () => {
    const first = Buffer.from("a");
    let head = appendHeadChunk(undefined, 0, first);
    expect(head).toBe(first);
    const capacities = new Set<number>();
    for (let length = 1; length < 64; length++) {
      head = appendHeadChunk(head, length, Buffer.from("b"));
      capacities.add(head.length);
    }
    expect({ capacities: [...capacities], first: first.toString(), head: head.toString() }).toEqual({
      capacities: [2, 4, 8, 16, 32, 64],
      first: "a",
      head: "a" + Buffer.alloc(63, "b"),
    });
    // A chunk that does not fit in twice the capacity gets a buffer of the size of the head. Other growth leaves zeros.
    expect(appendHeadChunk(head, 64, Buffer.alloc(1000, "c")).length).toBe(1064);
    expect([...appendHeadChunk(Buffer.from("ab"), 2, Buffer.from("c"))]).toEqual([97, 98, 99, 0]);
  });
});
