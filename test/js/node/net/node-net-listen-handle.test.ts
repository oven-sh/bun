/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * https://nodejs.org/api/net.html#serverlistenhandle-backlog-callback: the
 * handle "can be either a server, a socket (anything with an underlying
 * _handle member), or an object with an fd member". listen() takes the
 * `_handle` of a listening TCP server, one level down:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L2127-L2136
 *
 * Both servers then have the one listening socket. The server that listened
 * on it last gets its connections, and close() of either server closes it.
 * tls.Server, http.Server, https.Server and the http2 servers have the
 * listen() of net.Server.
 */
import assert from "node:assert";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";
import { describe, test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const keys = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "keys");
const tlsOptions = {
  key: readFileSync(join(keys, "agent1-key.pem"), "utf8"),
  cert: readFileSync(join(keys, "agent1-cert.pem"), "utf8"),
};

const isWindows = process.platform === "win32";
// Where Bun does not do what Node does (as of v26.3.0). Each case says what Node does.
const bunOnlyTest = process.versions.bun ? test : test.skip;

// `any`: http.Server is no net.Server in Bun's types, and `_handle` is in neither's.
type AnyServer = any;

// The four ways to give the handle of `donor`.
const handleForms: Record<string, (donor: AnyServer) => unknown> = {
  "the server": donor => donor,
  "{ _handle }": donor => ({ _handle: donor._handle }),
  "{ handle }": donor => ({ handle: donor._handle }),
  "its _handle": donor => donor._handle,
};

// What the server says to a plain TCP client, or the code of the error.
const tcpText = (port: number) => text(net.connect(port, "127.0.0.1")).catch((err: NodeJS.ErrnoException) => err.code!);

// "200 body", or the code of the error.
function httpGet(port: number, module: typeof http | typeof https = http, agent: http.Agent | false = false) {
  return new Promise<string>(resolve => {
    module
      .get({ host: "127.0.0.1", port, agent, rejectUnauthorized: false }, res => {
        text(res).then(
          body => resolve(`${res.statusCode} ${body}`),
          (err: NodeJS.ErrnoException) => resolve(err.code!),
        );
      })
      .on("error", (err: NodeJS.ErrnoException) => resolve(err.code!));
  });
}

function http2Get(authority: string) {
  return new Promise<string>((resolve, reject) => {
    const session = http2.connect(authority, { rejectUnauthorized: false });
    session.on("error", reject);
    const stream = session.request({ ":path": "/" });
    stream.on("error", reject);
    text(stream).then(body => {
      session.close();
      resolve(body);
    }, reject);
    stream.end();
  });
}

// Each class, with a client that reads what its server says: the name of the class.
type ServerClass = { create(): AnyServer; request(port: number): Promise<string>; answer: string };
const classes: Record<string, ServerClass> = {
  "net.Server": {
    create: () => net.createServer(socket => socket.end("net.Server")),
    request: tcpText,
    answer: "net.Server",
  },
  "tls.Server": {
    create: () => tls.createServer(tlsOptions, socket => socket.end("tls.Server")),
    request: port => text(tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })),
    answer: "tls.Server",
  },
  "http.Server": {
    create: () => http.createServer((req, res) => res.end("http.Server")),
    request: port => httpGet(port),
    answer: "200 http.Server",
  },
  "https.Server": {
    create: () => https.createServer(tlsOptions, (req, res) => res.end("https.Server")),
    request: port => httpGet(port, https),
    answer: "200 https.Server",
  },
  "http2.Http2Server": {
    create: () => http2.createServer((req, res) => res.end("http2.Http2Server")),
    request: port => http2Get(`http://127.0.0.1:${port}`),
    answer: "http2.Http2Server",
  },
  "http2.Http2SecureServer": {
    create: () => http2.createSecureServer(tlsOptions, (req, res) => res.end("http2.Http2SecureServer")),
    request: port => http2Get(`https://127.0.0.1:${port}`),
    answer: "http2.Http2SecureServer",
  },
};

// The net.Server whose handle the tests give away. Unless a test says what it does with a connection, it drops it:
// a server that lost its connections gets none.
async function listeningNetServer(onConnection: (socket: net.Socket) => void = socket => socket.destroy()) {
  const donor: AnyServer = net.createServer(onConnection);
  await once(donor.listen(0, "127.0.0.1"), "listening");
  return { donor, port: (donor.address() as AddressInfo).port };
}

const closed = (server: AnyServer) => new Promise<Error | undefined>(resolve => server.close(resolve));

function address(server: AnyServer) {
  try {
    return server.address();
  } catch (err) {
    return `throws ${(err as NodeJS.ErrnoException).code} ${(err as NodeJS.ErrnoException).syscall}`;
  }
}

const listenError = (err: NodeJS.ErrnoException & { address?: unknown; port?: unknown }) => ({
  code: err.code,
  errno: typeof err.errno,
  syscall: err.syscall,
  address: err.address,
  port: err.port,
  message: err.message,
});

let socketPaths = 0;
const unixSocketPath = () => join(tmpdir(), `listen-handle-${process.pid}-${socketPaths++}.sock`);

// For a process of this runtime.
const childEnv = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" };

// Runs `source` in a process of this runtime. `stderr` is there only if the process failed.
function run(source: string) {
  return new Promise<{ stdout: string; exitCode: unknown; stderr?: string }>(resolve => {
    execFile(process.execPath, ["-e", source], { env: childEnv }, (err, stdout, stderr) => {
      resolve(err ? { stdout, exitCode: err.code ?? err.signal, stderr } : { stdout, exitCode: 0 });
    });
  });
}

describe("server.listen(handle) with the handle of a net.Server that listens", () => {
  for (const [name, { create, request, answer }] of Object.entries(classes)) {
    for (const [form, handleOf] of Object.entries(handleForms)) {
      test(`${name} gets the connections, given ${form}`, async () => {
        let donorConnections = 0;
        const { donor, port } = await listeningNetServer(socket => {
          donorConnections++;
          socket.destroy();
        });
        const server = create();
        try {
          let callbacks = 0;
          assert.strictEqual(
            server.listen(handleOf(donor), () => callbacks++),
            server,
          );
          await once(server, "listening");
          assert.deepStrictEqual(
            {
              callbacks,
              address: server.address(),
              sameHandle: server._handle === donor._handle,
              listening: [donor.listening, server.listening],
              response: await request(port),
              donorConnections,
            },
            {
              callbacks: 1,
              address: { address: "127.0.0.1", family: "IPv4", port },
              sameHandle: true,
              listening: [true, true],
              response: answer,
              donorConnections: 0,
            },
          );
        } finally {
          server.close();
          donor.close();
        }
      });
    }
  }

  for (const name of ["net.Server", "http.Server"]) {
    const { create, request, answer } = classes[name];

    for (const closeFirst of ["the net.Server", "the server that listened on its handle"]) {
      test(`close() of ${closeFirst} closes the handle for both (${name})`, async () => {
        const { donor, port } = await listeningNetServer();
        const server = create();
        await once(server.listen(donor), "listening");
        assert.strictEqual(await request(port), answer);

        const [first, second] = closeFirst === "the net.Server" ? [donor, server] : [server, donor];
        assert.strictEqual(await closed(first), undefined);
        assert.deepStrictEqual(
          {
            first: [first.listening, address(first)],
            second: [second.listening, address(second)],
            connect: await tcpText(port),
          },
          {
            first: [false, null],
            second: [true, "throws EBADF address"],
            connect: "ECONNREFUSED",
          },
        );
        assert.strictEqual(await closed(second), undefined);
      });
    }

    test(`the net.Server keeps the connections that it accepted before (${name})`, async () => {
      const { promise: accepted, resolve: onAccepted } = Promise.withResolvers<net.Socket>();
      const { donor, port } = await listeningNetServer(onAccepted);
      const client = net.connect(port, "127.0.0.1");
      client.setEncoding("utf8");
      try {
        const donorSocket = await accepted;
        const server = create();
        await once(server.listen(donor), "listening");
        assert.strictEqual(await request(port), answer);

        donorSocket.write("still here");
        assert.strictEqual((await once(client, "data"))[0], "still here");
        const connections = await new Promise(resolve =>
          donor.getConnections((err: unknown, count: number) => resolve(count)),
        );
        assert.strictEqual(connections, 1);
        server.close();
      } finally {
        client.destroy();
        donor.close();
      }
    });

    test(`a handle that is closed emits 'error' EINVAL (${name})`, async () => {
      const { donor } = await listeningNetServer();
      const handle = donor._handle;
      assert.strictEqual(await closed(donor), undefined);

      for (const stale of [handle, { _handle: handle }]) {
        const server = create();
        assert.strictEqual(server.listen(stale), server);
        const [err] = await once(server, "error");
        assert.deepStrictEqual(
          { ...listenError(err), listening: server.listening },
          {
            code: "EINVAL",
            errno: "number",
            syscall: "listen",
            address: null,
            port: -1,
            message: "listen EINVAL: invalid argument",
            listening: false,
          },
        );
      }
    });

    // Node opens the descriptor of the pipe a second time, and libuv has it already.
    test(`the handle of a server on a unix socket emits 'error' EEXIST (${name})`, { skip: isWindows }, async () => {
      const donor = net.createServer();
      await once(donor.listen(unixSocketPath()), "listening");
      try {
        const server = create();
        server.listen(donor);
        const [err] = await once(server, "error");
        assert.deepStrictEqual(
          { ...listenError(err), listening: server.listening },
          {
            code: "EEXIST",
            errno: "number",
            syscall: "listen",
            address: null,
            port: undefined,
            message: "listen EEXIST: file already exists",
            listening: false,
          },
        );
      } finally {
        donor.close();
      }
    });

    // A named pipe has no descriptor, so Node finds neither a handle nor an address in the server.
    test(`the handle of a server on a named pipe is no handle (${name})`, { skip: !isWindows }, async () => {
      const donor = net.createServer();
      await once(donor.listen(`\\\\.\\pipe\\listen-handle-${process.pid}-${socketPaths++}`), "listening");
      try {
        const server = create();
        assert.throws(() => server.listen(donor), { code: "ERR_INVALID_ARG_VALUE", name: "TypeError" });
        assert.strictEqual(server.listening, false);
      } finally {
        donor.close();
      }
    });

    test(`an object that names no handle, port or path throws ERR_INVALID_ARG_VALUE (${name})`, async () => {
      const { donor } = await listeningNetServer();
      try {
        const notAHandle = [
          {},
          { host: "127.0.0.1" },
          { exclusive: true },
          { signal: new AbortController().signal },
          // Node looks one level down: a server under `handle` is no handle.
          { handle: donor },
          // A server that does not listen has no handle.
          net.createServer(),
        ];
        for (const options of notAHandle) {
          const server = create();
          assert.throws(() => server.listen(options), {
            code: "ERR_INVALID_ARG_VALUE",
            name: "TypeError",
            message: /^The argument 'options' must have the property "port" or "path"\. Received /,
          });
          assert.strictEqual(server.listening, false);
        }
      } finally {
        donor.close();
      }
    });
  }

  test("a connection that is open when the net.Server closes the handle is served until it ends", async () => {
    const { donor, port } = await listeningNetServer();
    const server = http.createServer((req, res) => res.end("ok"));
    await once(server.listen(donor), "listening");
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      assert.strictEqual(await httpGet(port, http, agent), "200 ok");
      assert.strictEqual(await closed(donor), undefined);
      // On the connection that the agent kept. A new one has nothing to connect to.
      assert.strictEqual(await httpGet(port, http, agent), "200 ok");
      assert.strictEqual(await httpGet(port), "ECONNREFUSED");

      const serverClosed = closed(server);
      agent.destroy();
      assert.strictEqual(await serverClosed, undefined);
    } finally {
      agent.destroy();
    }
  });

  test("a server that listens on the handle from inside the net.Server's 'connection' listener gets the next connection", async () => {
    const server = http.createServer((req, res) => res.end("from http"));
    const { donor, port } = await listeningNetServer(socket => {
      socket.end("from net");
      if (!server.listening) server.listen(donor);
    });
    try {
      assert.strictEqual(await tcpText(port), "from net");
      assert.deepStrictEqual([await httpGet(port), await httpGet(port)], ["200 from http", "200 from http"]);
    } finally {
      server.close();
      donor.close();
    }
  });

  // Six connections wait to be accepted when the loop turns. The listener of the first one gives the handle to another
  // server: what is accepted after that, in the same turn or a later one, is that server's.
  const changes: [from: "net.Server" | "http.Server", to: string, pauseOnConnect: boolean][] = [
    ["net.Server", "http.Server", false],
    ["net.Server", "https.Server", false],
    ["net.Server", "http.Server", true],
    ["http.Server", "net.Server", false],
    ["http.Server", "http.Server", false],
    ["http.Server", "https.Server", false],
    ["http.Server", "net.Server", true],
  ];
  for (const [from, to, pauseOnConnect] of changes) {
    const paused = pauseOnConnect ? ", and the net.Server pauses what it accepts" : "";
    test(`${to} takes the handle from ${from} inside a 'connection' listener${paused}`, async () => {
      const donor: AnyServer = net.createServer({ pauseOnConnect });
      await once(donor.listen(0, "127.0.0.1"), "listening");
      const { port } = donor.address();
      const first: AnyServer = from === "net.Server" ? donor : http.createServer((req, res) => res.end("first"));
      if (first !== donor) await once(first.listen(donor), "listening");
      const answer = "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nnext";
      const next: AnyServer =
        to === "net.Server"
          ? net.createServer(socket => socket.on("error", () => {}).end(answer))
          : to === "https.Server"
            ? https.createServer(tlsOptions, (req, res) => res.end("next"))
            : http.createServer((req, res) => res.end("next"));
      let firstConnections = 0;
      first.on("connection", (socket: net.Socket) => {
        if (firstConnections++ === 0) next.listen(first);
        if (first === donor) socket.destroy();
      });
      try {
        const outcomes = await Promise.all(
          Array.from({ length: 6 }, () => {
            const client =
              to === "https.Server"
                ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
                : net.connect(port, "127.0.0.1");
            let received = "";
            client.on(to === "https.Server" ? "secureConnect" : "connect", () =>
              client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"),
            );
            client.on("data", chunk => (received += chunk));
            // The client that reached the first server can fail: that server does not speak its protocol.
            client.on("error", () => {});
            return new Promise<string>(resolve =>
              client.on("close", () => resolve(received.endsWith("next") ? "next" : "first")),
            );
          }),
        );
        assert.deepStrictEqual(
          { outcomes: outcomes.sort(), firstConnections },
          { outcomes: ["first", "next", "next", "next", "next", "next"], firstConnections: 1 },
        );
      } finally {
        next.close();
        if (first !== donor) first.close();
        donor.close();
      }
    });
  }

  test("the net.Server closes the handle from the http server's 'connection' listener, and that connection is served", async () => {
    const { donor, port } = await listeningNetServer();
    const server: AnyServer = http.createServer((req, res) => res.end("ok"));
    server.once("connection", () => donor.close());
    await once(server.listen(donor), "listening");
    try {
      assert.strictEqual(await httpGet(port), "200 ok");
      assert.strictEqual(await httpGet(port), "ECONNREFUSED");
      assert.deepStrictEqual(
        [donor.listening, server.listening, address(server)],
        [false, true, "throws EBADF address"],
      );
    } finally {
      assert.strictEqual(await closed(server), undefined);
    }
  });

  test("the handle goes from server to server, and close() of any of them closes it", async () => {
    const { donor, port } = await listeningNetServer(socket => socket.end("donor"));
    const first: AnyServer = http.createServer((req, res) => res.end("first"));
    await once(first.listen(donor), "listening");
    assert.strictEqual(await httpGet(port), "200 first");

    // A net.Server takes it from an http server, given that http server.
    const second: AnyServer = net.createServer(socket => socket.end("second"));
    await once(second.listen(first), "listening");
    assert.strictEqual(await tcpText(port), "second");

    // An http server takes it from an http server.
    const third: AnyServer = http.createServer((req, res) => res.end("third"));
    await once(third.listen(second), "listening");
    const fourth: AnyServer = http.createServer((req, res) => res.end("fourth"));
    await once(fourth.listen(third), "listening");
    assert.strictEqual(await httpGet(port), "200 fourth");

    // A server that lost the connections still has the handle, and its address.
    const servers = [donor, first, second, third, fourth];
    const handle = donor._handle;
    assert.deepStrictEqual(
      servers.map(server => [server._handle === handle, server.listening, address(server)]),
      servers.map(() => [true, true, { address: "127.0.0.1", family: "IPv4", port }]),
    );

    // `first` lost the connections three servers ago, and closes the handle for all of them.
    assert.strictEqual(await closed(first), undefined);
    assert.deepStrictEqual(servers.map(address), [
      "throws EBADF address",
      null,
      "throws EBADF address",
      "throws EBADF address",
      "throws EBADF address",
    ]);
    assert.strictEqual(await httpGet(port), "ECONNREFUSED");
    assert.deepStrictEqual(await Promise.all([donor, second, third, fourth].map(closed)), [
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("listen() on a server that has a handle throws ERR_SERVER_ALREADY_LISTEN, and takes nothing", async () => {
    const { donor, port } = await listeningNetServer();
    const other = await listeningNetServer(socket => socket.end("other"));
    const server = http.createServer((req, res) => res.end("ok"));
    await once(server.listen(donor), "listening");
    try {
      assert.throws(() => server.listen(other.donor), { code: "ERR_SERVER_ALREADY_LISTEN" });
      assert.throws(() => donor.listen(server), { code: "ERR_SERVER_ALREADY_LISTEN" });
      assert.deepStrictEqual([await httpGet(port), await tcpText(other.port)], ["200 ok", "other"]);
    } finally {
      server.close();
      donor.close();
      other.donor.close();
    }
  });

  test("a tls.Server that listens on the handle takes a context for a server name", async () => {
    const { donor, port } = await listeningNetServer();
    const server = tls.createServer(tlsOptions, socket => socket.end(`sni ${(socket as AnyServer).servername}`));
    await once(server.listen(donor), "listening");
    try {
      server.addContext("named.test", tlsOptions);
      const client = tls.connect({ port, host: "127.0.0.1", servername: "named.test", rejectUnauthorized: false });
      assert.strictEqual(await text(client), "sni named.test");
    } finally {
      server.close();
      donor.close();
    }
  });

  // The handle is TCP: TLS is on it only if the server that listens on it speaks TLS.
  for (const name of ["http.Server", "https.Server"]) {
    test(`${name} serves on the handle of a tls.Server`, async () => {
      const donor = tls.createServer(tlsOptions, socket => socket.destroy());
      await once(donor.listen(0, "127.0.0.1"), "listening");
      const { port } = donor.address() as AddressInfo;
      const server = classes[name].create();
      try {
        await once(server.listen(donor), "listening");
        // Contexts that the tls.Server takes now are its own.
        donor.setSecureContext(tlsOptions);
        donor.addContext("named.test", tlsOptions);
        assert.strictEqual(await classes[name].request(port), classes[name].answer);
      } finally {
        server.close();
        donor.close();
      }
    });
  }

  // Node gives the TCP handle of the tls.Server to each of them.
  bunOnlyTest("a tls.Server gives its handle to an http or https server only", async () => {
    const passphrase = "not-to-be-printed";
    const donor: AnyServer = tls.createServer({ ...tlsOptions, passphrase }, socket => socket.destroy());
    await once(donor.listen(0, "127.0.0.1"), "listening");
    try {
      for (const name of ["net.Server", "tls.Server", "http2.Http2Server", "http2.Http2SecureServer"]) {
        for (const handle of [donor, { _handle: donor._handle }]) {
          const server = classes[name].create();
          assert.throws(
            () => server.listen(handle),
            (err: NodeJS.ErrnoException) => {
              assert.strictEqual(err.code, "ERR_INVALID_ARG_VALUE");
              // As in Node, the message has at most 128 characters of what it received.
              assert.match(err.message, /^The argument 'options' must have the property "port" or "path"\. Received /);
              assert.ok(err.message.length <= 204, err.message);
              assert.ok(!err.message.includes(passphrase) && !err.message.includes("PRIVATE KEY"), err.message);
              return true;
            },
          );
          assert.strictEqual(server.listening, false);
        }
      }
      assert.strictEqual(donor.listening, true);
    } finally {
      donor.close();
    }
  });

  // In Node an http.Server is a net.Server, and gives its handle like one.
  bunOnlyTest("an http.Server that bound its own port has no handle to give", async () => {
    const donor = http.createServer();
    await once(donor.listen(0, "127.0.0.1"), "listening");
    try {
      for (const name of ["net.Server", "http.Server"]) {
        const server = classes[name].create();
        assert.throws(() => server.listen(donor), { code: "ERR_INVALID_ARG_VALUE" });
        assert.strictEqual(server.listening, false);
      }
    } finally {
      donor.close();
    }
  });

  test("an 'upgrade' request on the handle reaches the http server", async () => {
    const { donor, port } = await listeningNetServer();
    const server = http.createServer((req, res) => res.end("not upgraded"));
    server.on("upgrade", (req, socket) => {
      socket.end(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n${req.url}`);
    });
    await once(server.listen(donor), "listening");
    try {
      const client = net.connect(port, "127.0.0.1");
      client.write("GET /chat HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n");
      assert.strictEqual(
        await text(client),
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n/chat",
      );
    } finally {
      server.close();
      donor.close();
    }
  });

  test("a WebSocket server on the http server takes the connections of the handle", async () => {
    const { donor, port } = await listeningNetServer();
    const server = http.createServer((req, res) => res.end("not upgraded"));
    const wss = new WebSocketServer({ server });
    wss.on("connection", socket => socket.on("message", message => socket.send(`echo ${message}`)));
    await once(server.listen(donor), "listening");
    const client = new WebSocket(`ws://127.0.0.1:${port}/`);
    try {
      await once(client, "open");
      client.send("hello");
      const [message] = await once(client, "message");
      assert.deepStrictEqual([String(message), await httpGet(port)], ["echo hello", "200 not upgraded"]);
    } finally {
      client.terminate();
      wss.close();
      server.close();
      donor.close();
    }
  });
});

// The servers of a process that has nothing else to do. The handle holds the event loop open for every server that
// has it, and either server lets go of it.
describe("server.listen(handle) and the life of the process", () => {
  const prelude = `
    const net = require("node:net");
    const http = require("node:http");
    const listening = (server, ...args) => new Promise(resolve => server.listen(...args, resolve));
    const closed = server => new Promise(resolve => server.close(resolve));
    const get = port =>
      new Promise(resolve =>
        http
          .get({ host: "127.0.0.1", port, agent: false }, res => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
          })
          .on("error", err => resolve(err.code)),
      );
    process.on("exit", code => console.log("exit", code));
    // Holds nothing open. Ends a process that stays where it must exit, and one that its test left behind.
    setTimeout(() => process.exit(2), 60_000).unref();
  `;

  // What Karma does with the server that it bound its port with: https://github.com/karma-runner/karma/blob/v6.4.4/lib/server.js#L233
  test("only the http server is closed, and the process exits", async () => {
    const result = await run(`
      ${prelude}
      (async () => {
        const bound = net.createServer(() => console.log("the net.Server got a connection"));
        await listening(bound, 0, "127.0.0.1");
        const { port } = bound.address();
        const server = http.createServer((req, res) => res.end("ok"));
        await listening(server, bound);
        console.log("status", await get(port), "same port", server.address().port === port);
        await closed(server);
        console.log("closed");
      })();
    `);
    assert.deepStrictEqual(result, { stdout: "status 200 same port true\nclosed\nexit 0\n", exitCode: 0 });
  });

  // `bound` is a net.Server that listens. `server` and `second` are http servers and `taker` is a net.Server: each
  // says its name to a client. The process has nothing else that holds its event loop open.
  const refScript = (steps: string) => `
    ${prelude}
    const bound = net.createServer(socket => socket.end("bound"));
    const server = http.createServer((req, res) => res.end("server"));
    const second = http.createServer((req, res) => res.end("second"));
    const taker = net.createServer(socket => socket.end("taker"));
    (async () => {
      await listening(bound, 0, "127.0.0.1");
      ${steps}
      console.log("ready", bound.address().port);
    })();
  `;
  const attached = "await listening(server, bound);";
  const takenByNet = `${attached} await listening(taker, server);`;
  const takenByHttp = `${attached} await listening(second, server);`;

  // The process ends by itself once it has said "ready".
  const exits: [name: string, steps: string][] = [
    ["unref() of the http server", `${attached} server.unref();`],
    ["unref() of the net.Server", `${attached} bound.unref();`],
    ["a net.Server that was unref'd before", `bound.unref(); ${attached}`],
    ["an http server that was unref'd before", `server.unref(); ${attached}`],
    [
      "a net.Server that takes the handle of an http server that was unref'd",
      `${attached} server.unref(); await listening(taker, server);`,
    ],
    ["unref() of an http server that lost the connections to a net.Server", `${takenByNet} server.unref();`],
    ["unref() of an http server that lost the connections to an http server", `${takenByHttp} server.unref();`],
  ];
  for (const [name, steps] of exits) {
    test(`the process exits: ${name}`, async () => {
      const { stdout, ...rest } = await run(refScript(steps));
      assert.deepStrictEqual(
        { stdout: stdout.replace(/^ready \d+/, "ready"), ...rest },
        { stdout: "ready\nexit 0\n", exitCode: 0 },
      );
    });
  }

  // The process stays, and the server that listened last answers.
  const stays: [name: string, steps: string, answer: string][] = [
    ["an http server on the handle", attached, "200 server"],
    ["ref() of the http server after its unref()", `${attached} server.unref(); server.ref();`, "200 server"],
    ["ref() of the net.Server after its unref()", `${attached} bound.unref(); bound.ref();`, "200 server"],
    [
      "ref() of the net.Server after unref() of the http server",
      `${attached} server.unref(); bound.ref();`,
      "200 server",
    ],
    ["a net.Server that takes the handle of an http server", takenByNet, "taker"],
    ["ref() of an http server that lost the connections", `${takenByNet} taker.unref(); server.ref();`, "taker"],
    ["an http server that takes the handle of an http server", takenByHttp, "200 second"],
  ];
  for (const [name, steps, answer] of stays) {
    test(`the process stays: ${name}`, async () => {
      const child = spawn(process.execPath, ["-e", refScript(steps)], {
        env: childEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });
      try {
        child.stdout.setEncoding("utf8");
        let stdout = "";
        for await (const chunk of child.stdout) {
          stdout += chunk;
          if (stdout.includes("\n")) break;
        }
        const port = Number(/^ready (\d+)\n/.exec(stdout)?.[1]);
        // A process that exits after "ready" has no socket to connect to.
        assert.strictEqual(await (answer.startsWith("200") ? httpGet(port) : tcpText(port)), answer);
      } finally {
        child.kill();
      }
    });
  }

  test("servers that take the handle and close in every order leave no socket open", { timeout: 60_000 }, async () => {
    const result = await run(`
      ${prelude}
      const fs = require("node:fs");
      // Windows has no directory of descriptors: there the count is 0, and this checks that every order ends.
      const descriptors = { linux: "/proc/self/fd", darwin: "/dev/fd" }[process.platform];
      const openDescriptors = () => (descriptors ? fs.readdirSync(descriptors).length : 0);
      const collect = () => globalThis.Bun?.gc(true);
      (async () => {
        let before;
        let answered = 0;
        const rounds = 64;
        for (let round = 0; round < rounds; round++) {
          if (round === 8) before = openDescriptors();
          const bound = net.createServer();
          await listening(bound, 0, "127.0.0.1");
          const { port } = bound.address();
          const server = http.createServer((req, res) => res.end("ok"));
          await listening(server, bound);
          if (round % 8 === 0 && (await get(port)) === 200) answered++;
          if (round % 3 === 0) {
            await closed(server);
            await closed(bound);
          } else if (round % 3 === 1) {
            await closed(bound);
            await closed(server);
          } else {
            const taker = net.createServer();
            await listening(taker, server);
            const last = http.createServer((req, res) => res.end("ok"));
            await listening(last, taker);
            await Promise.all([closed(last), closed(server), closed(taker), closed(bound)]);
          }
          if (round % 16 === 0) collect();
        }
        collect();
        console.log("answered", answered, "of", rounds / 8, "descriptors", openDescriptors() - before);
      })();
    `);
    assert.deepStrictEqual(result, { stdout: "answered 8 of 8 descriptors 0\nexit 0\n", exitCode: 0 });
  });

  test("a worker that is terminated while its http server has the handle closes it", { timeout: 60_000 }, async () => {
    const result = await run(`
      ${prelude}
      const { Worker } = require("node:worker_threads");
      const { once } = require("node:events");
      const worker = \`
        const net = require("node:net");
        const http = require("node:http");
        const bound = net.createServer();
        bound.listen(0, "127.0.0.1", () => {
          http
            .createServer((req, res) => res.end("ok"))
            .listen(bound, () => require("node:worker_threads").parentPort.postMessage(bound.address().port));
        });
      \`;
      (async () => {
        for (let round = 0; round < 2; round++) {
          const thread = new Worker(worker, { eval: true });
          const [port] = await once(thread, "message");
          const before = await get(port);
          await thread.terminate();
          console.log(before, await get(port));
        }
      })();
    `);
    assert.deepStrictEqual(result, { stdout: "200 ECONNREFUSED\n200 ECONNREFUSED\nexit 0\n", exitCode: 0 });
  });

  // A server can listen on a socket that its process was given. If that socket is TCP, its handle is one that
  // another server can listen on. A unix socket is a pipe, as above.
  test(
    "a net.Server that listens on a descriptor gives its handle if the socket is TCP",
    { skip: isWindows },
    async () => {
      const tcp: AnyServer = net.createServer();
      await once(tcp.listen(0, "127.0.0.1"), "listening");
      const { port } = tcp.address();
      const unix: AnyServer = net.createServer();
      await once(unix.listen(unixSocketPath()), "listening");

      const source = `
      ${prelude}
      const lines = [];
      // Descriptor 3: a TCP socket that listens.
      const tcp = net.createServer(socket => socket.destroy());
      const tcpDone = listening(tcp, { fd: 3 }).then(async () => {
        const server = http.createServer((req, res) => {
          res.end("from http");
          server.close();
        });
        await listening(server, tcp);
        lines.push("tcp: http.Server has the address of the net.Server: " + (server.address().port === tcp.address().port));
        await require("node:events").once(server, "close");
      });
      // Descriptor 4: a unix socket that listens.
      const unix = net.createServer();
      const unixDone = listening(unix, { fd: 4 }).then(async () => {
        lines.push("unix: net.Server listens on the descriptor");
        for (const [name, adopter] of [["net.Server", net.createServer()], ["http.Server", http.createServer()]]) {
          adopter.listen(unix, () => lines.push("unix: " + name + " listens"));
          const [err] = await require("node:events").once(adopter, "error");
          lines.push("unix: " + name + " " + err.message);
        }
        await closed(unix);
      });
      Promise.all([tcpDone, unixDone]).then(() => console.log(lines.sort().join("\\n")));
    `;
      const child = spawn(process.execPath, ["-e", source], {
        env: childEnv,
        stdio: ["ignore", "pipe", "inherit", tcp._handle.fd, unix._handle.fd],
      });
      try {
        // The process has both sockets now. This one keeps neither, so that it accepts nothing.
        assert.deepStrictEqual([await closed(tcp), await closed(unix)], [undefined, undefined]);
        const [response, stdout, [exitCode]] = await Promise.all([
          httpGet(port),
          text(child.stdout),
          once(child, "exit"),
        ]);
        assert.deepStrictEqual(
          { response, stdout, exitCode },
          {
            response: "200 from http",
            stdout:
              [
                "tcp: http.Server has the address of the net.Server: true",
                "unix: http.Server listen EEXIST: file already exists",
                "unix: net.Server listen EEXIST: file already exists",
                "unix: net.Server listens on the descriptor",
              ].join("\n") + "\nexit 0\n",
            exitCode: 0,
          },
        );
      } finally {
        child.kill();
      }
    },
  );
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, bunExe, nodeExeAtLeast, tempDir } = await import("harness");
  // Before v24 node does not run a TypeScript file without a flag.
  const node = nodeExeAtLeast("24.0.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", { timeout: 120_000 }, async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });

  describe("server.listen(handle) under bun --hot", () => {
    // A server that --hot keeps across reloads is found by the address that it was given. A server on a handle was
    // given none, like a server on port 0: neither may stand in for the other.
    test("servers on a handle and a server on port 0 are three servers", async () => {
      using dir = tempDir("listen-handle-hot", {
        "main.cjs": `
          const net = require("node:net");
          const http = require("node:http");
          const listening = (server, ...args) => new Promise(resolve => server.listen(...args, resolve));
          const get = port => fetch("http://127.0.0.1:" + port).then(res => res.text());
          // --hot keeps a process that failed. This ends it.
          setTimeout(() => process.exit(2), 60_000).unref();
          (async () => {
            const servers = [];
            for (const name of ["first", "second", "third"]) {
              const server = http.createServer((req, res) => res.end(name));
              if (name === "second") {
                await listening(server, 0);
              } else {
                const bound = net.createServer();
                await listening(bound, 0, "127.0.0.1");
                await listening(server, bound);
              }
              servers.push(server);
            }
            const ports = servers.map(server => server.address().port);
            console.log(new Set(ports).size, (await Promise.all(ports.map(get))).join(" "));
            process.exit(0);
          })();
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--hot", "main.cjs"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual(
        { stdout, exitCode, stderr: exitCode === 0 ? "" : stderr },
        { stdout: "3 first second third\n", exitCode: 0, stderr: "" },
      );
    });
  });
}
