// TCP keep-alive of node:net: what socket.setKeepAlive() leaves in the kernel, read back with getsockopt(2). Every
// expected value is what Node.js v26.12.1 leaves for the same call on Linux. The calls that the handle gets are in
// node-net-keepalive-handle.test.ts, which also runs under Node.js.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as cert, isDebug, isLinux, isWindows } from "harness";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";
import { canReadKeepAlive, keepAliveOf, type KeepAlive } from "./node-net-keepalive-kernel";

describe.skipIf(!canReadKeepAlive)("socket.setKeepAlive()", () => {
  /** The value that the socket had before the call. */
  const kept = "kept";
  type Kept = typeof kept;
  type Expected = [enabled: number, idle: number | Kept, interval: number | Kept, count: number | Kept];
  /** The source of a call on the socket `c`, which is also the name of its test. */
  type Row = [call: string, expected: Expected];

  let server: net.Server;
  let port: number;
  /** What a socket has before any call: off, then 7200, 75 and 9 on Linux. */
  let defaults: KeepAlive;

  const resolved = (expected: Expected) => expected.map((value, i) => (value === kept ? defaults[i] : value));
  /** Calls are source text: `@types/node` has the two parameters of Node.js v26.3.0 only. */
  const run = (call: string, c: net.Socket) => new Function("c", `return ${call}`)(c);

  /** A server that gives each socket it accepts to `once(server, "accepted")`. */
  async function listening(options: net.ServerOpts | tls.TlsOptions = {}, create: Function = net.createServer) {
    const server: net.Server = create(options, (socket: net.Socket) => {
      socket.on("error", () => {});
      socket.resume();
      server.emit("accepted", socket);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server;
  }
  const portOf = (server: net.Server) => (server.address() as net.AddressInfo).port;

  /** A client whose connection exists. */
  async function connected(client: net.Socket = net.connect(port, "127.0.0.1")) {
    try {
      if (client.connecting) await once(client, "connect");
    } catch (error) {
      client.destroy();
      throw error;
    }
    return client;
  }

  /** A new client and the socket that `server` accepts for it. An 'error' of the client rejects. */
  async function pair(server: net.Server, client = net.connect(portOf(server), "127.0.0.1"), ready = "connect") {
    try {
      const [[socket]] = await Promise.all([once(server, "accepted"), once(client, ready)]);
      return { client, socket: socket as net.Socket };
    } catch (error) {
      client.destroy();
      server.close();
      throw error;
    }
  }

  beforeAll(async () => {
    server = await listening();
    port = portOf(server);
    const probe = await connected();
    try {
      defaults = keepAliveOf(probe);
    } finally {
      probe.destroy();
    }
  });

  afterAll(() => {
    server?.close();
  });

  test("a socket starts with keep-alive off", () => {
    expect(defaults[0]).toBe(0);
  });

  describe("on a connected socket", () => {
    const rows: Row[] = [
      ["c.setKeepAlive(true, 5000, 3000, 7)", [1, 5, 3, 7]],
      ["c.setKeepAlive({ enable: true, initialDelay: 5000, interval: 3000, count: 7 })", [1, 5, 3, 7]],
      ["c.setKeepAlive({ enable: false })", [0, kept, kept, kept]],
      ["c.setKeepAlive(true, 5000)", [1, 5, 1, 10]],
      ["c.setKeepAlive(true, 5000, 3000)", [1, 5, 3, 10]],
      ["c.setKeepAlive(true, 5000, undefined, 7)", [1, 5, 1, 7]],
      ["c.setKeepAlive(true)", [1, kept, kept, kept]],

      // The smallest values that are written, and the largest delay that is not.
      ["c.setKeepAlive(true, 1000)", [1, 1, 1, 10]],
      ["c.setKeepAlive(true, 1000, 1000, 1)", [1, 1, 1, 1]],
      ["c.setKeepAlive(true, 5000, 3000, 1)", [1, 5, 3, 1]],
      ["c.setKeepAlive(true, 999, 1000, 1)", [1, kept, kept, kept]],

      // A zero leaves all three as they are: https://github.com/nodejs/node/blob/v26.12.1/deps/uv/src/unix/tcp.c#L479-L480
      ["c.setKeepAlive(true, 5000, 0, 7)", [1, kept, kept, kept]],
      ["c.setKeepAlive(true, 0, 3000, 7)", [1, kept, kept, kept]],
      ["c.setKeepAlive(true, 5000, 3000, 0)", [1, kept, kept, kept]],
      ["c.setKeepAlive(true, 500, 3000, 7)", [1, kept, kept, kept]],
      ["c.setKeepAlive(true, 5000, 500, 7)", [1, kept, kept, kept]],
      ["c.setKeepAlive(true, 5000, null, null)", [1, kept, kept, kept]],
      ["c.setKeepAlive(true, 5000, NaN, NaN)", [1, kept, kept, kept]],
      ["c.setKeepAlive(true, 5000, Infinity, Infinity)", [1, kept, kept, kept]],
      ["c.setKeepAlive(true, 5000, 2 ** 32 * 1000, 7)", [1, kept, kept, kept]],

      // What is not a uint32 is 1 second, or 10 probes: https://github.com/nodejs/node/blob/v26.12.1/src/tcp_wrap.cc#L219-L225
      ["c.setKeepAlive(true, 5000, -3000, -7)", [1, 5, 1, 10]],
      ["c.setKeepAlive(true, 5000, 3000, 7.5)", [1, 5, 3, 10]],
      ["c.setKeepAlive(true, 5000, 3000, -0)", [1, 5, 3, 10]],
      ["c.setKeepAlive(true, 5000, 3000, 2 ** 32)", [1, 5, 3, 10]],
      ["c.setKeepAlive(true, 5000, 2 ** 31 * 1000, 7)", [1, 5, 1, 7]],
      ['c.setKeepAlive(true, 5000, 3000, "7")', [1, 5, 3, 10]],
      // The division by 1000 makes a number of the interval.
      ['c.setKeepAlive(true, 5000, "3000", "abc")', [1, 5, 3, 10]],

      // Every object is the options. A function is not.
      ["c.setKeepAlive({})", [0, kept, kept, kept]],
      ["c.setKeepAlive({ enable: true })", [1, kept, kept, kept]],
      ["c.setKeepAlive({ enable: true, initialDelay: 5000 })", [1, 5, 1, 10]],
      ["c.setKeepAlive({ enable: true, interval: 3000, count: 7 })", [1, kept, kept, kept]],
      ["c.setKeepAlive({ enable: true, initialDelay: 5000, interval: 0 })", [1, kept, kept, kept]],
      ["c.setKeepAlive({ enable: true, initialDelay: 5000, count: 0 })", [1, kept, kept, kept]],
      ["c.setKeepAlive({ enable: 1, initialDelay: 5000, interval: 3000, count: 7 })", [1, 5, 3, 7]],
      ["c.setKeepAlive({ enable: true, initialDelay: 5000, interval: 3000, count: 7 }, 9000, 4000, 3)", [1, 5, 3, 7]],
      ["c.setKeepAlive(null, 5000, 3000, 7)", [0, kept, kept, kept]],
      ["c.setKeepAlive([])", [0, kept, kept, kept]],
      ["c.setKeepAlive([true, 5000])", [0, kept, kept, kept]],
      ["c.setKeepAlive(new Boolean(true), 5000)", [0, kept, kept, kept]],
      ["c.setKeepAlive(function () {}, 5000, 3000, 7)", [1, 5, 3, 7]],

      // One call after another.
      ["c.setKeepAlive(true, 5000, 3000, 7).setKeepAlive(true, 6000, 3000, 7)", [1, 6, 3, 7]],
      ["c.setKeepAlive(true, 5000, 3000, 7).setKeepAlive(true, 5000, 4000, 7)", [1, 5, 4, 7]],
      ["c.setKeepAlive(true, 5000, 3000, 7).setKeepAlive(true, 5000, 3000, 8)", [1, 5, 3, 8]],
      ["c.setKeepAlive(true, 5000, 3000, 7).setKeepAlive(true, 5000)", [1, 5, 1, 10]],
      ["c.setKeepAlive(true, 5000, 3000, 7).setKeepAlive(false)", [0, 5, 3, 7]],
      ["c.setKeepAlive(true, 5000, 3000, 7).setKeepAlive(false, 6000, 4000, 8)", [0, 5, 3, 7]],
      ["c.setKeepAlive(true, 5000, 3000, 7).setKeepAlive(false).setKeepAlive(true, 6000)", [1, 6, 1, 10]],
      ["c.setKeepAlive(true, 5000).setKeepAlive({ enable: false })", [0, 5, 1, 10]],
    ];
    // Linux takes 32767 seconds and 127 probes at most. The options are written in this order, up to the first that it refuses.
    const rowsOfLinux: Row[] = [
      ["c.setKeepAlive(true, 5000, 32767000, 127)", [1, 5, 32767, 127]],
      ["c.setKeepAlive(true, -5000, 3000, 7)", [1, kept, kept, kept]],
      ["c.setKeepAlive(true, 32768000, 3000, 7)", [1, kept, kept, kept]],
      ["c.setKeepAlive(true, 5000, 32768000, 7)", [1, 5, kept, kept]],
      ["c.setKeepAlive(true, 5000, 3000, 128)", [1, 5, 3, kept]],
      ["c.setKeepAlive(true, 5000, 3000, 2 ** 31)", [1, 5, 3, kept]],
      ["c.setKeepAlive(true, 5000, 3000, 2 ** 32 - 1)", [1, 5, 3, kept]],
    ];

    test.each(isLinux ? [...rows, ...rowsOfLinux] : rows)("%s", async (call, expected) => {
      const client = await connected();
      try {
        expect(run(call, client)).toBe(client);
        expect(keepAliveOf(client)).toEqual(resolved(expected));
      } finally {
        client.destroy();
      }
    });

    // The handle's own method takes milliseconds. What replaces it gets Node's seconds and can pass them on to it.
    test("a function put over setKeepAlive() of the handle gets the call, and the socket gets the values", async () => {
      const client = await connected();
      try {
        const calls: unknown[][] = [];
        // @ts-expect-error `_handle` is the native socket
        client._handle.setKeepAlive = (...args: unknown[]) => calls.push(args);
        run("c.setKeepAlive(true, 5000, 3000, 7)", client);
        expect({ calls, kernel: keepAliveOf(client) }).toEqual({ calls: [[true, 5, 3, 7]], kernel: [1, 5, 3, 7] });
      } finally {
        client.destroy();
      }
    });

    test("a function that passes the call on to the method it replaced", async () => {
      const client = await connected();
      try {
        const calls: unknown[][] = [];
        // @ts-expect-error `_handle` is the native socket
        const handle = client._handle;
        const original = handle.setKeepAlive;
        handle.setKeepAlive = function (...args: unknown[]) {
          calls.push(args);
          return original.apply(this, args);
        };
        run("c.setKeepAlive(true, 2000000, 3000, 7)", client);
        const first = keepAliveOf(client);
        run("c.setKeepAlive(true, 6000)", client);
        expect({ calls, first, second: keepAliveOf(client) }).toEqual({
          calls: [
            [true, 2000, 3, 7],
            [true, 6, undefined, undefined],
          ],
          first: [1, 2000, 3, 7],
          second: [1, 6, 1, 10],
        });
      } finally {
        client.destroy();
      }
    });

    test("the method of the handle, assigned to the handle again, does not get seconds", async () => {
      const client = await connected();
      try {
        // @ts-expect-error `_handle` is the native socket
        client._handle.setKeepAlive = client._handle.setKeepAlive;
        // As milliseconds, -5 is out of the range of that method.
        run("c.setKeepAlive(true, -5000, 3000, 7).setKeepAlive(true, 2000000)", client);
        expect(keepAliveOf(client)).toEqual([1, 2000, 1, 10]);
      } finally {
        client.destroy();
      }
    });
  });

  describe("before the connection exists", () => {
    const rows: Row[] = [
      ["c.setKeepAlive(true, 5000, 3000, 7)", [1, 5, 3, 7]],
      ["c.setKeepAlive({ enable: true, initialDelay: 5000, interval: 3000, count: 7 })", [1, 5, 3, 7]],
      ["c.setKeepAlive(true, 5000)", [1, 5, 1, 10]],
      ["c.setKeepAlive(true, 5000, 3000, 7).setKeepAlive(true, 6000)", [1, 6, 1, 10]],
      ["c.setKeepAlive(true, 5000, 3000, 7).setKeepAlive({ enable: false })", [0, kept, kept, kept]],
      ["c.setKeepAlive({ enable: false })", [0, kept, kept, kept]],
    ];
    // A delay, an interval or a count that is not written.
    const rowsThatWriteNoTiming = [
      "c.setKeepAlive(true)",
      "c.setKeepAlive(true, 0)",
      "c.setKeepAlive(true, 500)",
      "c.setKeepAlive(true, 5000, 0, 7)",
    ];
    const withNoHandle = async (call: string) => {
      const client = new net.Socket();
      try {
        expect(run(call, client)).toBe(client);
        await connected(client.connect(port, "127.0.0.1"));
        return keepAliveOf(client);
      } finally {
        client.destroy();
      }
    };
    const whileItConnects = async (call: string) => {
      const client = net.connect(port, "127.0.0.1");
      try {
        expect(run(call, client)).toBe(client);
        await connected(client);
        return keepAliveOf(client);
      } finally {
        client.destroy();
      }
    };

    test.each(rows)("on a socket with no handle: %s", async (call, expected) => {
      expect(await withNoHandle(call)).toEqual(resolved(expected));
    });
    test.each(rowsThatWriteNoTiming)("on a socket with no handle: %s", async call => {
      expect(await withNoHandle(call)).toEqual(resolved([1, kept, kept, kept]));
    });

    test.each(rows)("on a socket that connects: %s", async (call, expected) => {
      expect(await whileItConnects(call)).toEqual(resolved(expected));
    });
    // libuv writes 60, 1 and 10 when it opens a socket whose handle was told to keep alive, and Node's call after that
    // writes nothing: https://github.com/nodejs/node/blob/v26.12.1/deps/uv/src/unix/stream.c#L417-L421
    test.todo.each(rowsThatWriteNoTiming)("on a socket that connects: %s", async call => {
      expect(await whileItConnects(call)).toEqual([1, 60, 1, 10]);
    });

    test("the keepAlive and keepAliveInitialDelay options give one probe a second and 10 probes", async () => {
      const client = await connected(
        net.connect({ port, host: "127.0.0.1", keepAlive: true, keepAliveInitialDelay: 5000 }),
      );
      try {
        const fromTheOptions = keepAliveOf(client);
        run("c.setKeepAlive(true, 5000, 3000, 7)", client);
        expect({ fromTheOptions, interval: keepAliveOf(client) }).toEqual({
          fromTheOptions: [1, 5, 1, 10],
          interval: [1, 5, 3, 7],
        });
      } finally {
        client.destroy();
      }
    });

    test("a connection after destroy() gets what the socket had", async () => {
      const client = await connected();
      try {
        run("c.setKeepAlive(true, 5000, 3000, 7)", client);
        client.destroy();
        await once(client, "close");
        await connected(client.connect(port, "127.0.0.1"));
        expect(keepAliveOf(client)).toEqual([1, 5, 3, 7]);
      } finally {
        client.destroy();
      }
    });
  });

  // Node.js still writes the options of a socket that sent its FIN.
  describe("after end(), while the peer keeps its side open", () => {
    const rows: [before: string, after: string, expected: Expected][] = [
      ["", "c.setKeepAlive(true, 5000, 3000, 7)", [1, 5, 3, 7]],
      ["", "c.setKeepAlive(true, 5000)", [1, 5, 1, 10]],
      ["c.setKeepAlive(true, 5000, 3000, 7)", "c.setKeepAlive(false)", [0, 5, 3, 7]],
    ];
    const named = rows.map(row => [`${row[0] && row[0] + "; "}c.end(); ${row[1]}`, ...row] as const);

    test.each(named)("%s", async (_, before, after, expected) => {
      const server = await listening({ allowHalfOpen: true });
      const { client } = await pair(
        server,
        net.connect({ port: portOf(server), host: "127.0.0.1", allowHalfOpen: true }),
      );
      try {
        if (before) run(before, client);
        client.end();
        await once(client, "finish");
        run(after, client);
        expect(keepAliveOf(client)).toEqual(resolved(expected));
      } finally {
        client.destroy();
        server.close();
      }
    });
  });

  describe("on an accepted socket", () => {
    test("setKeepAlive() with an interval and a count, and with the options", async () => {
      const server = await listening();
      const { client, socket } = await pair(server);
      try {
        run("c.setKeepAlive(true, 5000, 3000, 7)", socket);
        const interval = keepAliveOf(socket);
        run("c.setKeepAlive({ enable: true, initialDelay: 6000, interval: 4000, count: 8 })", socket);
        expect({ interval, options: keepAliveOf(socket) }).toEqual({ interval: [1, 5, 3, 7], options: [1, 6, 4, 8] });
      } finally {
        client.destroy();
        server.close();
      }
    });

    test("the keepAlive and keepAliveInitialDelay options of the server, then setKeepAlive()", async () => {
      const server = await listening({ keepAlive: true, keepAliveInitialDelay: 5000 });
      const { client, socket } = await pair(server);
      try {
        const fromTheServer = keepAliveOf(socket);
        run("c.setKeepAlive(true, 6000, 3000, 7)", socket);
        const interval = keepAliveOf(socket);
        run("c.setKeepAlive({ enable: false })", socket);
        expect({ fromTheServer, interval, off: keepAliveOf(socket) }).toEqual({
          fromTheServer: [1, 5, 1, 10],
          interval: [1, 6, 3, 7],
          off: [0, 6, 3, 7],
        });
      } finally {
        client.destroy();
        server.close();
      }
    });

    // Two processes of a debug build take most of the timeout to start.
    test.skipIf(isDebug)("of a cluster worker, whose server has the keepAlive options", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, "node-net-keepalive-cluster-fixture.ts")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
        stdout: JSON.stringify({ fromTheServer: [1, 5, 1, 10], interval: [1, 6, 3, 7], off: [0, 6, 3, 7] }),
        stderr: "",
        exitCode: 0,
      });
    });
  });

  describe("on a tls.TLSSocket", () => {
    const connectOptions = { host: "127.0.0.1", ca: cert.cert, servername: "localhost" };

    test("of a client and of a server", async () => {
      const server = await listening({ ...cert }, tls.createServer);
      const client = tls.connect({ port: portOf(server), ...connectOptions });
      // Before the connection exists, so the socket keeps the values and gives them to the handle later.
      run("c.setKeepAlive({ enable: true, initialDelay: 6000, interval: 4000, count: 8 })", client);
      const { socket } = await pair(server, client, "secureConnect");
      try {
        run("c.setKeepAlive(true, 5000, 3000, 7)", socket);
        expect({ client: keepAliveOf(client), server: keepAliveOf(socket) }).toEqual({
          client: [1, 6, 4, 8],
          server: [1, 5, 3, 7],
        });
      } finally {
        client.destroy();
        server.close();
      }
    });

    test("that wraps a connected socket", async () => {
      const server = await listening({ ...cert }, tls.createServer);
      const raw = await connected(net.connect(portOf(server), "127.0.0.1"));
      const client = tls.connect({ socket: raw, ...connectOptions });
      try {
        run("c.setKeepAlive(true, 5000, 3000, 7)", client);
        await once(client, "secureConnect");
        expect(keepAliveOf(raw)).toEqual([1, 5, 3, 7]);
      } finally {
        client.destroy();
        raw.destroy();
        server.close();
      }
    });

    // The call has to reach the socket under the wrap, and then libuv's 60, 1 and 10 apply, as above.
    test.todo("that wraps a socket which still connects", async () => {
      const server = await listening({ ...cert }, tls.createServer);
      const raw = net.connect(portOf(server), "127.0.0.1");
      const client = tls.connect({ socket: raw, ...connectOptions });
      try {
        run("c.setKeepAlive(true, 5000, 3000, 7)", client);
        await once(client, "secureConnect");
        expect(keepAliveOf(raw)).toEqual([1, 60, 1, 10]);
      } finally {
        client.destroy();
        raw.destroy();
        server.close();
      }
    });
  });

  test("http.ClientRequest#setSocketKeepAlive() takes the options", async () => {
    const server = http.createServer((_, response) => response.end("ok"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const request = http.request({ port: portOf(server), host: "127.0.0.1" });
    // destroy() ends a request that was not sent with "socket hang up".
    request.on("error", () => {});
    try {
      // @ts-expect-error the types of this method have `enable` and `initialDelay`
      request.setSocketKeepAlive({ enable: true, initialDelay: 5000, interval: 3000, count: 7 });
      const [socket] = (await once(request, "socket")) as [net.Socket];
      expect(keepAliveOf(await connected(socket))).toEqual([1, 5, 3, 7]);
    } finally {
      request.destroy();
      server.close();
    }
  });

  // Bun.Socket, fetch and Bun.sql share the writer of these values with node:net. They give it no interval and no count.
  test("Bun.Socket#setKeepAlive(true, 4000) still gives one probe a second and 10 probes", async () => {
    using listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const socket = await Bun.connect({ hostname: "127.0.0.1", port: listener.port, socket: { data() {} } });
    try {
      const returned = socket.setKeepAlive(true, 4000);
      // Windows is not told the interval and the count: its own are one second and 10 probes.
      expect({ returned, kernel: keepAliveOf(socket) }).toEqual({
        returned: true,
        kernel: resolved(isWindows ? [1, 4, kept, kept] : [1, 4, 1, 10]),
      });
    } finally {
      socket.terminate();
    }
  });
});
