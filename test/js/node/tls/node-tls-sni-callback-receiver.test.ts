/**
 * Node.js calls the SNICallback of a server as a method of the connection's server-side TLSSocket:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L207-L236
 *
 * Works with both:
 *   bun bd test test/js/node/tls/node-tls-sni-callback-receiver.test.ts
 *   node --test test/js/node/tls/node-tls-sni-callback-receiver.test.ts
 */
import assert from "node:assert";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import tls from "node:tls";

const fixtures = join(import.meta.dirname, "fixtures");
const identity = {
  key: readFileSync(join(fixtures, "agent2-key.pem")),
  cert: readFileSync(join(fixtures, "agent2-cert.pem")),
};
const isWindows = process.platform === "win32";
const isBun = typeof Bun !== "undefined";

type ServerSide = tls.TLSSocket & { server?: tls.Server };
type Answer = (err: Error | null, context?: tls.SecureContext) => void;
type SNICallback = (this: ServerSide, servername: string, answer: Answer) => void;

// Listens on a port of its own, or on `path`. Returns what a client dials.
async function listen(server: net.Server, path?: string) {
  if (path) server.listen(path);
  else server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return path ? { path } : { port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" };
}

// A door serves TLS with `options`. It passes each server-side socket to `onSecure` when its handshake is done.
type Door = { dial: tls.ConnectionOptions; server?: tls.Server; close(): void };
type OpenDoor = (options: tls.TlsOptions, onSecure: (socket: tls.TLSSocket) => void) => Promise<Door>;
const doors: Record<string, OpenDoor> = {
  "listen(port)": async (options, onSecure) => {
    const server = tls.createServer(options).on("secureConnection", onSecure);
    return { dial: await listen(server), server, close: () => server.close() };
  },
  "listen(path)": async (options, onSecure) => {
    // A unix socket. On Windows the path that a server listens on is a named pipe.
    const dir = isWindows ? undefined : mkdtempSync(join(tmpdir(), "tls-sni-receiver-"));
    const path = dir ? join(dir, "tls.sock") : `\\\\.\\pipe\\tls-sni-receiver-${process.pid}`;
    const server = tls.createServer(options).on("secureConnection", onSecure);
    const close = () => {
      server.close();
      if (dir) rmSync(dir, { recursive: true, force: true });
    };
    return { dial: await listen(server, path), server, close };
  },
  "http2.createSecureServer().listen(port)": async (options, onSecure) => {
    const server = http2.createSecureServer(options).on("secureConnection", onSecure);
    return { dial: { ...(await listen(server)), ALPNProtocols: ["h2"] }, server, close: () => server.close() };
  },
  "server.emit('connection', netSocket)": async (options, onSecure) => {
    const server = tls.createServer(options).on("secureConnection", onSecure);
    const front = net.createServer(raw => server.emit("connection", raw));
    return { dial: await listen(front), server, close: () => front.close() };
  },
  "new TLSSocket(netSocket, { isServer: true, SNICallback })": async (options, onSecure) => {
    const front = net.createServer(raw => {
      const socket = new tls.TLSSocket(raw, { ...options, isServer: true });
      socket.on("error", () => {}).on("secure", () => onSecure(socket));
    });
    return { dial: await listen(front), close: () => front.close() };
  },
};

describe("`this` in an SNICallback is the TLSSocket of the connection", () => {
  for (const [name, open] of Object.entries(doors)) {
    // Bun's TLS listener on a Windows named pipe does not ask for the server name, so the callback does not run there.
    const todo = isWindows && name === "listen(path)" && "the SNICallback does not run on a Windows named pipe";
    test(name, { todo }, async () => {
      const names = ["a.test", "b.test"];
      const receivers = new Map<string, ServerSide>();
      const secured = new Map<unknown, tls.TLSSocket>();
      const answers: Answer[] = [];
      const done = Promise.withResolvers<void>();
      const SNICallback: SNICallback = function (servername, answer) {
        receivers.set(servername, this);
        // The first handshake waits here until the second one asks: two are in flight, and one answer is late.
        if (answers.push(answer) === names.length) for (const answer of answers) answer(null);
      };
      const door = await open({ ...identity, SNICallback }, socket => {
        socket.on("error", () => {});
        secured.set(socket.servername, socket);
        if (secured.size === names.length) done.resolve();
      });
      const clients = names.map(servername =>
        tls.connect({ ...door.dial, servername, rejectUnauthorized: false }).on("error", done.reject),
      );
      try {
        await done.promise;
        assert.deepStrictEqual(
          names.map(servername => {
            const receiver = receivers.get(servername);
            return {
              isTLSSocket: receiver instanceof tls.TLSSocket,
              server: receiver?.server === door.server,
              isTheSocketOfItsConnection: receiver === secured.get(servername),
            };
          }),
          names.map(() => ({ isTLSSocket: true, server: true, isTheSocketOfItsConnection: true })),
        );
      } finally {
        for (const socket of [...clients, ...secured.values()]) socket.destroy();
        door.close();
      }
    });
  }

  test("a connection accepted before close() still gets its socket", async () => {
    const receivers: ServerSide[] = [];
    const SNICallback: SNICallback = function (_, answer) {
      receivers.push(this);
      answer(null);
    };
    const server = tls.createServer({ ...identity, SNICallback });
    const secured = once(server, "secureConnection");
    const raw = net.connect(await listen(server));
    try {
      await once(server, "connection");
      server.close();
      tls.connect({ socket: raw, servername: "a.test", rejectUnauthorized: false }).on("error", () => {});
      const [socket] = await secured;
      socket.on("error", () => {}).destroy();
      const [receiver] = receivers;
      assert.deepStrictEqual(
        { isTheSocketOfItsConnection: receiver === socket, server: receiver?.server === server },
        { isTheSocketOfItsConnection: true, server: true },
      );
    } finally {
      raw.destroy();
    }
  });
});

describe("an SNICallback that uses its socket", () => {
  // One client with a server name against a listening server. Resolves with the 'tlsClientError' of the server.
  async function refused(SNICallback: SNICallback) {
    const server = tls.createServer({ ...identity, SNICallback });
    const reported = once(server, "tlsClientError") as Promise<[NodeJS.ErrnoException, tls.TLSSocket]>;
    const client = tls.connect({ ...(await listen(server)), servername: "a.test", rejectUnauthorized: false });
    const clientError = once(client, "error") as Promise<[NodeJS.ErrnoException]>;
    try {
      const [[err, socket], [seenByClient]] = await Promise.all([reported, clientError]);
      return { err, socket, client: seenByClient.code };
    } finally {
      client.destroy();
      server.close();
    }
  }

  test("this.destroy() drops the connection, and the server reports it on that socket", async () => {
    const receivers: unknown[] = [];
    const { err, socket, client } = await refused(function (_, answer) {
      receivers.push(this);
      this.destroy();
      answer(null);
    });
    assert.deepStrictEqual(
      { server: err.code, onTheReceiver: socket === receivers[0], client },
      { server: "ECONNRESET", onTheReceiver: true, client: "ECONNRESET" },
    );
  });

  for (const when of ["in the call", "on a later turn"]) {
    test(`an error answered ${when} is reported on that socket`, async () => {
      const refusal = new Error("no such name");
      const receivers: unknown[] = [];
      const { err, socket, client } = await refused(function (_, answer) {
        receivers.push(this);
        if (when === "in the call") answer(refusal);
        else setImmediate(answer, refusal);
      });
      assert.deepStrictEqual(
        { isTheRefusal: err === refusal, onTheReceiver: socket === receivers[0], client },
        { isTheRefusal: true, onTheReceiver: true, client: "ECONNRESET" },
      );
    });
  }

  // Node.js assigns `servername` when the ClientHello arrives. Bun assigns it when the handshake ends.
  test(
    "this.servername is the requested name",
    { todo: isBun && "servername is assigned when the handshake ends" },
    async () => {
      const seen: unknown[] = [];
      const SNICallback: SNICallback = function (_, answer) {
        seen.push(this.servername);
        answer(null);
      };
      const server = tls.createServer({ ...identity, SNICallback }, socket => socket.on("error", () => {}).end());
      const client = tls.connect({ ...(await listen(server)), servername: "a.test", rejectUnauthorized: false });
      try {
        await once(client, "secureConnect");
        assert.deepStrictEqual(seen, ["a.test"]);
      } finally {
        client.destroy();
        server.close();
      }
    },
  );
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (isBun) {
  const node = Bun.which("node");
  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", { timeout: 120_000 }, async () => {
      await using proc = Bun.spawn({
        // A test that hangs in Node.js fails by name instead of running this one out of time.
        cmd: [node!, "--test-timeout=15000", "--test-force-exit", import.meta.filename],
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
