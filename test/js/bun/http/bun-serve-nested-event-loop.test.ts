import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { connect } from "node:net";

// `req.url` and `req.headers` are read lazily from the `uWS::HttpRequest`,
// whose views point into the per-loop receive buffer. A `fetch` handler that
// runs the event loop inside itself lets the next socket read overwrite those
// bytes in place, so the handler must not end up with another request's head.
//
// The nested run here is `Bun.build` with a plugin whose `setup()` returns a
// pending promise: the call waits for that promise with the event loop.

const FIRST = "1111111111111111";
const SECOND = "2222222222222222";

function head(token: string) {
  return (
    `GET /u-${token} HTTP/1.1\r\n` +
    `Host: h-${token}.example\r\n` +
    `Authorization: Bearer au-${token}\r\n` +
    `Cookie: c=ck-${token}\r\n` +
    `\r\n`
  );
}

async function connectTo(port: number) {
  const socket = connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.on("error", () => {});
  socket.on("data", () => {});
  return socket;
}

type Head = { url: string; authorization: string | null; cookie: string | null };

// Runs the event loop from inside the handler. The build does not return until
// the plugin's `setup()` promise settles, and the second request settles it, so
// the tests need no timing.
function eventLoopRunner(entrypoint: string) {
  let resolveSetup: (() => void) | undefined;
  return {
    end: () => resolveSetup!(),
    run: () =>
      Bun.build({
        entrypoints: [entrypoint],
        plugins: [
          {
            name: "pending-setup",
            setup: () =>
              new Promise<void>(resolve => {
                resolveSetup = resolve;
              }),
          },
        ],
      }),
  };
}

async function handlerReadsItsOwnHead(readAfterAwait: boolean) {
  using dir = tempDir("serve-nested-event-loop", { "entry.js": "export default 1;\n" });

  const recorded = Promise.withResolvers<Head>();
  const nested = eventLoopRunner(`${dir}/entry.js`);
  let second: ReturnType<typeof connect> | undefined;
  let requests = 0;

  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      if (++requests > 1) {
        // The second request was parsed inside the first handler's nested
        // event loop run, so its head sits in the receive buffer now.
        nested.end();
        return new Response("second");
      }

      second!.write(head(SECOND));

      if (readAfterAwait) {
        // The handler reads nothing before it suspends, so the head is the
        // copy the server makes when it hands the request to the async path.
        await nested.run();
      } else {
        nested.run().then(
          () => {},
          () => {},
        );
      }

      recorded.resolve({
        url: req.url,
        authorization: req.headers.get("authorization"),
        cookie: req.headers.get("cookie"),
      });
      return new Response("first");
    },
  });

  const first = await connectTo(server.port);
  second = await connectTo(server.port);
  try {
    first.write(head(FIRST));
    expect(await recorded.promise).toEqual({
      url: `http://h-${FIRST}.example/u-${FIRST}`,
      authorization: `Bearer au-${FIRST}`,
      cookie: `c=ck-${FIRST}`,
    });
  } finally {
    first.destroy();
    second.destroy();
  }
}

test("a handler that runs the event loop reads its own url and headers", async () => {
  await handlerReadsItsOwnHead(false);
});

test("a handler that runs the event loop and then suspends reads its own url and headers", async () => {
  await handlerReadsItsOwnHead(true);
});

test("server.upgrade after the handler runs the event loop still reads its own handshake", async () => {
  using dir = tempDir("serve-nested-event-loop-ws", { "entry.js": "export default 1;\n" });

  const nested = eventLoopRunner(`${dir}/entry.js`);
  let second: ReturnType<typeof connect> | undefined;
  let requests = 0;

  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, server) {
      if (++requests > 1) {
        nested.end();
        return new Response("second");
      }

      second!.write(head(SECOND));
      nested.run().then(
        () => {},
        () => {},
      );

      // `Sec-WebSocket-Key` and `Upgrade` come from the same head. Reading
      // the second request's values here fails the handshake, and the client
      // that did send a handshake gets an error instead of a socket.
      if (server.upgrade(req)) return undefined;
      return new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.send("open");
      },
      message() {},
    },
  });

  second = await connectTo(server.port);
  const opened = Promise.withResolvers<string>();
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
  ws.onmessage = event => opened.resolve(String(event.data));
  ws.onerror = () => opened.reject(new Error("the upgrade failed"));
  ws.onclose = () => opened.reject(new Error("the socket closed before it opened"));
  try {
    expect(await opened.promise).toBe("open");
  } finally {
    ws.close();
    second.destroy();
  }
});

// The other nested run: in a directory with no `node_modules`, the resolver
// auto-installs, and `require()` of a package that is not installed waits for
// the registry with this thread's event loop
// (`PackageManager::sleep_until` -> `AnyEventLoop::tick_raw`). That reaches
// the same `Loop` entry points as `Bun.build` above. The fixture runs in its
// own process because the test runner's own directory has `node_modules`.
const autoInstallFixture = `
import { createRequire } from "node:module";
import { connect } from "node:net";

const require = createRequire(import.meta.url);
const head = token =>
  \`GET /u-\${token} HTTP/1.1\\r\\nHost: h-\${token}.example\\r\\n\` +
  \`Authorization: Bearer au-\${token}\\r\\nCookie: c=ck-\${token}\\r\\n\\r\\n\`;

const secondDispatched = Promise.withResolvers();

// Answers only once the second connection's head is in the receive buffer, so
// the nested run cannot end before the bytes that used to clobber it arrive.
await using registry = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch() {
    await secondDispatched.promise;
    return new Response("not found", { status: 404 });
  },
});
process.env.BUN_CONFIG_REGISTRY = \`http://127.0.0.1:\${registry.port}/\`;

let second;
let requests = 0;
const recorded = Promise.withResolvers();

await using server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    if (++requests > 1) {
      secondDispatched.resolve();
      return new Response("second");
    }

    second.write(head("${SECOND}"));
    try {
      require("a-package-that-is-not-installed-f4f0b1");
    } catch {}

    recorded.resolve({
      url: req.url,
      authorization: req.headers.get("authorization"),
      cookie: req.headers.get("cookie"),
    });
    return new Response("first");
  },
});

async function connectTo(port) {
  const socket = connect(port, "127.0.0.1");
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.on("error", () => {});
  socket.on("data", () => {});
  return socket;
}

const first = await connectTo(server.port);
second = await connectTo(server.port);
first.write(head("${FIRST}"));
console.log(JSON.stringify(await recorded.promise));
first.destroy();
second.destroy();
process.exit(0);
`;

test("a handler that auto-installs reads its own url and headers", async () => {
  using dir = tempDir("serve-nested-auto-install", {
    "fixture.mjs": autoInstallFixture,
    // The resolver walks up from here, so it must find no `node_modules`.
    "cache/.keep": "",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: `${dir}/cache` },
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stderr, head: JSON.parse(stdout.trim() || "null") }).toEqual({
    stderr: "",
    head: {
      url: `http://h-${FIRST}.example/u-${FIRST}`,
      authorization: `Bearer au-${FIRST}`,
      cookie: `c=ck-${FIRST}`,
    },
  });
  expect(exitCode).toBe(0);
});
