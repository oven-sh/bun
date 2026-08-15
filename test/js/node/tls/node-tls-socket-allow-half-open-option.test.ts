import { describe, expect, test } from "bun:test";
import { tls as COMMON_CERT } from "harness";
import net, { type AddressInfo } from "node:net";
import { Duplex, PassThrough } from "node:stream";
import tls, { TLSSocket } from "node:tls";

// A TLSSocket built over an existing socket takes that socket's allowHalfOpen;
// the option only counts when the TLSSocket opens its own connection.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L592
// tls.connect({ socket }) passes the socket to that same constructor argument.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1756-L1757
// What a half-open TLSSocket outlives is the wrapped socket's EOF; the wrapped
// socket closing still destroys it.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L739-L741

function listen(server: net.Server): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  return promise;
}

function closed(socket: Duplex): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  socket.once("close", () => resolve());
  return promise;
}

// A generic Duplex carrying a socket's bytes (what tunnelling code hands to
// tls.connect({ socket })); it closes once the socket it carries has closed.
function bridge(raw: net.Socket): Duplex {
  const duplex = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      raw.write(chunk, encoding, callback);
    },
    final(callback) {
      raw.end();
      callback();
    },
  });
  raw.on("data", chunk => duplex.push(chunk));
  raw.on("end", () => duplex.push(null));
  raw.on("close", () => duplex.destroy());
  return duplex;
}

describe("TLSSocket allowHalfOpen", () => {
  test("new TLSSocket(socket) takes the wrapped socket's allowHalfOpen, ignoring the option", () => {
    const halfOpenSocket = new net.Socket({ allowHalfOpen: true });
    const defaultSocket = new net.Socket();
    // stream.Duplex defaults to allowHalfOpen: true; net.Socket defaults to false.
    const defaultDuplex = new Duplex({ read() {} });
    const duplexWithoutRead = new Duplex();
    const halfOpenDisabledDuplex = new Duplex({ allowHalfOpen: false, read() {} });
    try {
      expect({
        halfOpenSocket: new TLSSocket(halfOpenSocket, { allowHalfOpen: false }).allowHalfOpen,
        defaultSocket: new TLSSocket(defaultSocket, { allowHalfOpen: true }).allowHalfOpen,
        defaultDuplex: new TLSSocket(defaultDuplex, { allowHalfOpen: false }).allowHalfOpen,
        duplexWithoutRead: new TLSSocket(duplexWithoutRead, { allowHalfOpen: false }).allowHalfOpen,
        halfOpenDisabledDuplex: new TLSSocket(halfOpenDisabledDuplex, { allowHalfOpen: true }).allowHalfOpen,
      }).toEqual({
        halfOpenSocket: true,
        defaultSocket: false,
        defaultDuplex: true,
        duplexWithoutRead: true,
        halfOpenDisabledDuplex: false,
      });
    } finally {
      halfOpenSocket.destroy();
      defaultSocket.destroy();
      defaultDuplex.destroy();
      duplexWithoutRead.destroy();
      halfOpenDisabledDuplex.destroy();
    }
  });

  test("without a socket to wrap, the option is honored", () => {
    expect({
      noArguments: new TLSSocket().allowHalfOpen,
      option: new TLSSocket(undefined, { allowHalfOpen: true }).allowHalfOpen,
    }).toEqual({ noArguments: false, option: true });
  });

  test("tls.connect({ socket }) takes the given socket's allowHalfOpen, ignoring the option", () => {
    const halfOpenSocket = new net.Socket({ allowHalfOpen: true });
    const defaultSocket = new net.Socket();
    const defaultDuplex = new PassThrough();
    const halfOpenDisabledDuplex = new Duplex({
      allowHalfOpen: false,
      read() {},
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const tlsSockets: TLSSocket[] = [];
    function connectOver(socket: Duplex, allowHalfOpen: boolean): boolean {
      const tlsSocket = tls.connect({ socket, allowHalfOpen, rejectUnauthorized: false });
      tlsSocket.on("error", () => {});
      tlsSockets.push(tlsSocket);
      return tlsSocket.allowHalfOpen;
    }
    try {
      expect({
        halfOpenSocket: connectOver(halfOpenSocket, false),
        defaultSocket: connectOver(defaultSocket, true),
        defaultDuplex: connectOver(defaultDuplex, false),
        halfOpenDisabledDuplex: connectOver(halfOpenDisabledDuplex, true),
      }).toEqual({
        halfOpenSocket: true,
        defaultSocket: false,
        defaultDuplex: true,
        halfOpenDisabledDuplex: false,
      });
    } finally {
      for (const tlsSocket of tlsSockets) tlsSocket.destroy();
      halfOpenSocket.destroy();
      defaultSocket.destroy();
      defaultDuplex.destroy();
      halfOpenDisabledDuplex.destroy();
    }
  });

  describe.concurrent("over a connection", () => {
    test("a server-side wrap of a half-open socket stays writable after the peer ends", async () => {
      const afterPeerEnd = Promise.withResolvers<Record<string, boolean>>();
      const wrapClosed = Promise.withResolvers<void>();
      let wrapped: TLSSocket | undefined;
      const rawServer = net.createServer({ allowHalfOpen: true }, raw => {
        wrapped = new TLSSocket(raw, { isServer: true, ...COMMON_CERT });
        wrapped.on("error", afterPeerEnd.reject);
        wrapped.once("close", () => wrapClosed.resolve());
        wrapped.resume();
        wrapped.once("end", () => {
          // An allowHalfOpen: false Duplex ends its writable side from a
          // nextTick queued by the 'end' emit, so look after that tick.
          setImmediate(() =>
            afterPeerEnd.resolve({
              allowHalfOpen: wrapped!.allowHalfOpen,
              writable: wrapped!.writable,
              writableEnded: wrapped!.writableEnded,
              destroyed: wrapped!.destroyed,
            }),
          );
        });
      });
      let client: TLSSocket | undefined;
      try {
        const port = await listen(rawServer);
        client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => client!.end());
        client.on("error", afterPeerEnd.reject);
        client.resume();
        const clientClosed = closed(client);
        expect(await afterPeerEnd.promise).toEqual({
          allowHalfOpen: true,
          writable: true,
          writableEnded: false,
          destroyed: false,
        });
        wrapped!.end();
        await Promise.all([wrapClosed.promise, clientClosed]);
      } finally {
        client?.destroy();
        wrapped?.destroy();
        rawServer.close();
      }
    });

    test("a server-side wrap of a regular socket ends itself after the peer ends, even with allowHalfOpen: true", async () => {
      const wrapClosed = Promise.withResolvers<Record<string, boolean>>();
      let wrapped: TLSSocket | undefined;
      const rawServer = net.createServer(raw => {
        wrapped = new TLSSocket(raw, { isServer: true, allowHalfOpen: true, ...COMMON_CERT });
        wrapped.on("error", wrapClosed.reject);
        wrapped.resume();
        wrapped.once("close", () =>
          wrapClosed.resolve({ allowHalfOpen: wrapped!.allowHalfOpen, writableEnded: wrapped!.writableEnded }),
        );
      });
      let client: TLSSocket | undefined;
      try {
        const port = await listen(rawServer);
        client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => client!.end());
        client.on("error", wrapClosed.reject);
        client.resume();
        const clientClosed = closed(client);
        expect(await wrapClosed.promise).toEqual({ allowHalfOpen: false, writableEnded: true });
        await clientClosed;
      } finally {
        client?.destroy();
        wrapped?.destroy();
        rawServer.close();
      }
    });

    test("a socket injected into a tls.Server keeps its own allowHalfOpen", async () => {
      // The tls.Server's allowHalfOpen option only applies to connections it
      // accepts itself; an injected socket keeps its flag in both directions.
      async function injectInto(serverAllowHalfOpen: boolean, rawAllowHalfOpen: boolean): Promise<boolean> {
        const tlsServer = tls.createServer({ ...COMMON_CERT, allowHalfOpen: serverAllowHalfOpen });
        const secured = Promise.withResolvers<TLSSocket>();
        tlsServer.on("secureConnection", secured.resolve);
        tlsServer.on("tlsClientError", secured.reject);
        const rawServer = net.createServer({ allowHalfOpen: rawAllowHalfOpen }, raw =>
          tlsServer.emit("connection", raw),
        );
        let client: TLSSocket | undefined;
        let serverSide: TLSSocket | undefined;
        try {
          const port = await listen(rawServer);
          client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
          client.on("error", secured.reject);
          client.resume();
          serverSide = await secured.promise;
          serverSide.resume();
          const bothClosed = Promise.all([closed(serverSide), closed(client)]);
          serverSide.end();
          client.end();
          await bothClosed;
          return serverSide.allowHalfOpen;
        } finally {
          client?.destroy();
          serverSide?.destroy();
          rawServer.close();
          tlsServer.close();
        }
      }
      const [halfOpenSocketIntoRegularServer, regularSocketIntoHalfOpenServer] = await Promise.all([
        injectInto(false, true),
        injectInto(true, false),
      ]);
      expect({ halfOpenSocketIntoRegularServer, regularSocketIntoHalfOpenServer }).toEqual({
        halfOpenSocketIntoRegularServer: true,
        regularSocketIntoHalfOpenServer: false,
      });
    });

    test("tls.connect({ socket }) over a half-open socket stays writable after the server ends", async () => {
      const serverSockets: TLSSocket[] = [];
      const server = tls.createServer(COMMON_CERT, socket => {
        serverSockets.push(socket);
        socket.on("error", () => {});
        socket.resume();
        socket.end();
      });
      let raw: net.Socket | undefined;
      let client: TLSSocket | undefined;
      try {
        const port = await listen(server);
        const afterServerEnd = Promise.withResolvers<Record<string, boolean>>();
        raw = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
        raw.on("error", afterServerEnd.reject);
        client = tls.connect({ socket: raw, allowHalfOpen: false, rejectUnauthorized: false });
        client.on("error", afterServerEnd.reject);
        client.resume();
        const clientClosed = closed(client);
        const allowHalfOpenAtConstruction = client.allowHalfOpen;
        client.once("end", () => {
          setImmediate(() =>
            afterServerEnd.resolve({
              allowHalfOpen: client!.allowHalfOpen,
              writable: client!.writable,
              writableEnded: client!.writableEnded,
              destroyed: client!.destroyed,
            }),
          );
        });
        expect(allowHalfOpenAtConstruction).toBe(true);
        expect(await afterServerEnd.promise).toEqual({
          allowHalfOpen: true,
          writable: true,
          writableEnded: false,
          destroyed: false,
        });
        client.end();
        await clientClosed;
      } finally {
        client?.destroy();
        raw?.destroy();
        for (const socket of serverSockets) socket.destroy();
        server.close();
      }
    });
  });

  describe.concurrent("the wrapped socket closing", () => {
    // Nothing below ends or destroys the TLS socket itself, and each one is
    // half-open, so only the wrapped socket's close can take it down.
    type Outcome = { allowHalfOpen: boolean; destroyed: boolean };
    const destroyedHalfOpen: Outcome = { allowHalfOpen: true, destroyed: true };

    function outcomeOnClose(socket: TLSSocket, outcome: PromiseWithResolvers<Outcome>): void {
      socket.on("error", outcome.reject);
      socket.once("close", () => outcome.resolve({ allowHalfOpen: socket.allowHalfOpen, destroyed: socket.destroyed }));
    }

    test("tls.connect({ socket: duplex }): the duplex closing", async () => {
      const serverSockets: TLSSocket[] = [];
      const server = tls.createServer(COMMON_CERT, socket => {
        serverSockets.push(socket);
        socket.on("error", () => {});
        socket.resume();
        socket.end();
      });
      let raw: net.Socket | undefined;
      let client: TLSSocket | undefined;
      try {
        const port = await listen(server);
        const outcome = Promise.withResolvers<Outcome>();
        raw = net.connect({ port, host: "127.0.0.1" });
        raw.on("error", outcome.reject);
        client = tls.connect({ socket: bridge(raw), rejectUnauthorized: false });
        outcomeOnClose(client, outcome);
        client.resume();
        expect(await outcome.promise).toEqual(destroyedHalfOpen);
      } finally {
        client?.destroy();
        raw?.destroy();
        for (const socket of serverSockets) socket.destroy();
        server.close();
      }
    });

    test("tls.connect({ socket }): the socket being destroyed", async () => {
      const serverSockets: TLSSocket[] = [];
      const server = tls.createServer(COMMON_CERT, socket => {
        serverSockets.push(socket);
        socket.on("error", () => {});
        socket.resume();
      });
      let raw: net.Socket | undefined;
      let client: TLSSocket | undefined;
      try {
        const port = await listen(server);
        const outcome = Promise.withResolvers<Outcome>();
        const secured = Promise.withResolvers<void>();
        raw = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
        raw.on("error", outcome.reject);
        client = tls.connect({ socket: raw, rejectUnauthorized: false }, secured.resolve);
        outcomeOnClose(client, outcome);
        client.on("error", secured.reject);
        client.resume();
        await secured.promise;
        raw.destroy();
        expect(await outcome.promise).toEqual(destroyedHalfOpen);
      } finally {
        client?.destroy();
        raw?.destroy();
        for (const socket of serverSockets) socket.destroy();
        server.close();
      }
    });

    test("new TLSSocket(socket, { isServer }): the socket being destroyed", async () => {
      const outcome = Promise.withResolvers<Outcome>();
      const secured = Promise.withResolvers<void>();
      let raw: net.Socket | undefined;
      let wrapped: TLSSocket | undefined;
      const rawServer = net.createServer({ allowHalfOpen: true }, socket => {
        raw = socket;
        wrapped = new TLSSocket(socket, { isServer: true, ...COMMON_CERT });
        outcomeOnClose(wrapped, outcome);
        wrapped.on("error", secured.reject);
        wrapped.once("secure", secured.resolve);
        wrapped.resume();
      });
      let client: TLSSocket | undefined;
      try {
        const port = await listen(rawServer);
        client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
        client.on("error", () => {});
        client.resume();
        await secured.promise;
        raw!.destroy();
        expect(await outcome.promise).toEqual(destroyedHalfOpen);
      } finally {
        client?.destroy();
        wrapped?.destroy();
        raw?.destroy();
        rawServer.close();
      }
    });

    test("new TLSSocket(duplex, { isServer }): the duplex closing", async () => {
      const outcome = Promise.withResolvers<Outcome>();
      const secured = Promise.withResolvers<void>();
      let wrapped: TLSSocket | undefined;
      const rawServer = net.createServer(socket => {
        wrapped = new TLSSocket(bridge(socket), { isServer: true, ...COMMON_CERT });
        outcomeOnClose(wrapped, outcome);
        wrapped.on("error", secured.reject);
        wrapped.once("secure", secured.resolve);
        wrapped.resume();
      });
      let client: TLSSocket | undefined;
      try {
        const port = await listen(rawServer);
        client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
        client.on("error", () => {});
        client.resume();
        await secured.promise;
        client.destroy();
        expect(await outcome.promise).toEqual(destroyedHalfOpen);
      } finally {
        client?.destroy();
        wrapped?.destroy();
        rawServer.close();
      }
    });
  });
});
