import { describe, expect, test } from "bun:test";
import { tempDir, tls } from "harness";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { BlockList } from "node:net";
import { join } from "node:path";

// Node stores the list as a plain property on the server (net.Server constructor).
type ServerWithBlockList = http.Server & { blockList?: BlockList };

type Outcome = { statusCode: number | undefined; body: string } | { error: string | undefined };

// Every client in this file connects from 127.0.0.1.
function blockListCoveringLocalhost() {
  const blockList = new BlockList();
  blockList.addAddress("127.0.0.1");
  return blockList;
}

function blockListNotCoveringLocalhost() {
  const blockList = new BlockList();
  blockList.addSubnet("10.0.0.0", 8);
  return blockList;
}

async function listen(server: http.Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

function request(mod: typeof http | typeof https, port: number): Promise<Outcome> {
  return new Promise(resolve => {
    mod
      .get({ host: "127.0.0.1", port, agent: false, rejectUnauthorized: false }, res => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", chunk => (body += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, body }));
      })
      .on("error", (error: NodeJS.ErrnoException) => resolve({ error: error.code }));
  });
}

describe("https server blockList option", () => {
  const constructors: [string, (options: https.ServerOptions, listener: http.RequestListener) => https.Server][] = [
    ["https.createServer()", (options, listener) => https.createServer(options, listener)],
    ["new https.Server()", (options, listener) => new https.Server(options, listener)],
  ];

  test.each(constructors)(
    "%s: a blocked peer is closed before 'connection' and never reaches the request handler",
    async (_name, construct) => {
      const blockList = blockListCoveringLocalhost();
      const events: string[] = [];
      const server = construct({ ...tls, blockList }, (_req, res) => {
        events.push("request");
        res.end("served");
      }) as ServerWithBlockList;
      server.on("connection", () => events.push("connection"));
      server.on("secureConnection", () => events.push("secureConnection"));
      // Node only emits 'drop' for maxConnections; a blocked peer is closed silently.
      server.on("drop", () => events.push("drop"));
      try {
        const port = await listen(server);
        expect(await request(https, port)).toEqual({ error: "ECONNRESET" });
        expect(events).toEqual([]);
        expect(server.blockList).toBe(blockList);
      } finally {
        server.close();
      }
    },
  );

  test("a peer outside the list is served", async () => {
    const server = https.createServer({ ...tls, blockList: blockListNotCoveringLocalhost() }, (_req, res) => {
      res.end("served");
    });
    try {
      const port = await listen(server);
      expect(await request(https, port)).toEqual({ statusCode: 200, body: "served" });
    } finally {
      server.close();
    }
  });

  test("a value that is not a net.BlockList is rejected", () => {
    const notABlockList = { check: () => true } as any;
    expect(() => https.createServer({ ...tls, blockList: notABlockList })).toThrowWithCode(
      TypeError,
      "ERR_INVALID_ARG_TYPE",
    );
  });
});

describe("http.Server blockList", () => {
  test("server.blockList assigned after listen() applies to the next connection", async () => {
    let requests = 0;
    const server = http.createServer((_req, res) => {
      requests++;
      res.end("served");
    }) as ServerWithBlockList;
    try {
      const port = await listen(server);
      expect(await request(http, port)).toEqual({ statusCode: 200, body: "served" });

      server.blockList = blockListCoveringLocalhost();
      expect(await request(http, port)).toEqual({ error: "ECONNRESET" });
      expect(requests).toBe(1);

      server.blockList = undefined;
      expect(await request(http, port)).toEqual({ statusCode: 200, body: "served" });
      expect(requests).toBe(2);
    } finally {
      server.close();
    }
  });

  test("a unix socket peer has no IP address to check and is served", async () => {
    using dir = tempDir("http-blocklist", {});
    const socketPath = join(String(dir), "server.sock");
    const server = http.createServer((_req, res) => {
      res.end("served");
    }) as ServerWithBlockList;
    server.blockList = blockListCoveringLocalhost();
    try {
      server.listen(socketPath);
      await once(server, "listening");
      const response = await fetch("http://localhost/", { unix: socketPath, headers: { connection: "close" } });
      expect({ statusCode: response.status, body: await response.text() }).toEqual({ statusCode: 200, body: "served" });
    } finally {
      server.close();
    }
  });

  test("the constructor option is ignored on a plain http server, like Node's http.Server", async () => {
    const options = { blockList: blockListCoveringLocalhost() } as any;
    const server = http.createServer(options, (_req, res) => {
      res.end("served");
    }) as ServerWithBlockList;
    try {
      expect(server.blockList).toBeUndefined();
      const port = await listen(server);
      expect(await request(http, port)).toEqual({ statusCode: 200, body: "served" });
    } finally {
      server.close();
    }
  });
});
