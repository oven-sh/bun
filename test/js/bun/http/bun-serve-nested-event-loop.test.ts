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

test("the development error page of a handler that runs the event loop names its own request", async () => {
  using dir = tempDir("serve-nested-event-loop-dev", { "entry.js": "export default 1;\n" });

  // A subprocess, because the development error log goes to stderr.
  const script = `
    const { connect } = require("node:net");
    const head = token =>
      "GET /u-" + token + " HTTP/1.1\\r\\nHost: h-" + token + ".example\\r\\nConnection: close\\r\\n\\r\\n";
    let resolveSetup, second, requests = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      development: true,
      fetch() {
        if (++requests > 1) {
          resolveSetup();
          return new Response("second");
        }
        second.write(head("${SECOND}"));
        Bun.build({
          entrypoints: [process.env.ENTRY],
          plugins: [{ name: "pending-setup", setup: () => new Promise(resolve => (resolveSetup = resolve)) }],
        }).then(() => {}, () => {});
        throw new Error("boom");
      },
    });
    const open = () =>
      new Promise((resolve, reject) => {
        const socket = connect(server.port, "127.0.0.1", () => resolve(socket));
        socket.on("error", reject);
      });
    const first = await open();
    second = await open();
    second.on("data", () => {});
    let page = "";
    first.on("data", chunk => (page += chunk.toString("latin1")));
    first.on("close", () => {
      console.log(page.match(/GET - \\S+ failed/)?.[0]);
      server.stop(true);
      process.exit(0);
    });
    first.write(head("${FIRST}"));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, ENTRY: `${dir}/entry.js` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const failed = `GET - http://h-${FIRST}.example/u-${FIRST} failed`;
  expect(stdout.trim()).toBe(failed);
  expect(stderr).toContain(failed);
  expect(exitCode).toBe(0);
});
