import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Resolving a package that is not installed, with auto-install on, waits for
// the registry inside a synchronous call. That wait must block the thread. It
// used to run the JS event loop, so timers, immediates and other sockets'
// callbacks ran inside `require()`, and a `Bun.serve` handler that made the
// call read another request's url out of the shared receive buffer.
//
// The test is the registry and both HTTP clients. It holds the manifest
// request until the second client's request has been written, so the second
// request is readable for the whole time the first handler is inside the call.
// No timing is involved: the manifest request itself proves the handler is
// inside the call.

type Gate = { requested: Promise<void>; arrived: () => void; release: () => void; released: Promise<void> };

function makeRegistry() {
  const gates = new Map<string, Gate>();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const gate = gates.get(decodeURIComponent(new URL(req.url).pathname.slice(1)));
      if (gate) {
        gate.arrived();
        await gate.released;
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/`,
    gateFor(packageName: string) {
      const requested = Promise.withResolvers<void>();
      const released = Promise.withResolvers<void>();
      const gate: Gate = {
        requested: requested.promise,
        arrived: requested.resolve,
        release: released.resolve,
        released: released.promise,
      };
      gates.set(packageName, gate);
      return gate;
    },
    [Symbol.dispose]: () => void server.stop(true),
  };
}

async function* lines(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true });
    for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
      yield buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
    }
  }
}

async function connectTo(port: number) {
  const socket = connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  socket.on("error", () => {});
  socket.on("data", () => {});
  socket.setNoDelay(true);
  return socket;
}

function write(socket: Socket, path: string, host: string) {
  return new Promise<void>((resolve, reject) =>
    socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\n\r\n`, error => (error ? reject(error) : resolve())),
  );
}

const doors = [
  "require",
  "require.resolve",
  "Bun.resolveSync",
  "import.meta.resolve",
  "import.meta.resolveSync",
  "import()",
  "Bun.resolve",
];

describe.concurrent("auto-install does not run the event loop inside", () => {
  test.each(doors)("%s", async door => {
    const packageName = `not-installed-${doors.indexOf(door)}`;
    using registry = makeRegistry();
    const gate = registry.gateFor(packageName);
    // An empty directory, so the resolver finds no node_modules above it.
    using dir = tempDir("autoinstall-no-reentry", {});

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--install=force",
        join(import.meta.dir, "resolve-autoinstall-no-js-reentry-fixture.ts"),
        door,
        packageName,
      ],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_CONFIG_REGISTRY: registry.url,
        NPM_CONFIG_REGISTRY: registry.url,
        BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = proc.stderr.text();
    // If the child dies, the step that waits on it fails with the child's
    // stderr. Without this, a crash is a timeout or a JSON parse error.
    const died = proc.exited.then(async code => {
      throw new Error(`the child exited (code ${code}, signal ${proc.signalCode}):\n${await stderr}`);
    });
    died.catch(() => {});

    const output = lines(proc.stdout);
    const nextJson = async () => {
      const line = await Promise.race([output.next(), died]);
      return line.done ? await died : JSON.parse(line.value);
    };
    const { port } = (await nextJson()) as { port: number };

    const first = await connectTo(port);
    const second = await connectTo(port);
    try {
      await write(first, "/first", "first.example");
      // The handler is inside the call now, waiting for the registry.
      await Promise.race([gate.requested, died]);
      await write(second, "/second", "second.example");
      gate.release();

      const result = await nextJson();
      proc.kill();
      expect({ ...result, stderr: await stderr }).toEqual({
        url: "http://first.example/first",
        ranInsideTheCall: [],
        stderr: "",
      });
    } finally {
      first.destroy();
      second.destroy();
    }
  });
});

// https://github.com/oven-sh/bun/issues/43842. A handler memoises the import()
// of an optional peer that is not installed. While the first import() waited
// for the registry, the event loop ran the other requests' handlers inside it,
// before `p` was assigned. Each of them called import() again, inside the one
// before, and with enough requests the stack overflowed.
test.concurrent("a memoised import() of a missing package runs once for concurrent Bun.serve requests", async () => {
  const packageName = "not-installed-optional-peer";
  using registry = makeRegistry();
  const gate = registry.gateFor(packageName);
  using dir = tempDir("autoinstall-no-reentry-memoised", {
    "server.ts": `
      let p: Promise<unknown> | undefined;
      let imports = 0;
      function getOptional() {
        if (!p) {
          imports++;
          p = import("${packageName}").catch(() => undefined);
        }
        return p;
      }
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch() {
          await getOptional();
          return new Response("imports " + imports);
        },
      });
      console.log(JSON.stringify({ port: server.port }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=force", "server.ts"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: registry.url,
      NPM_CONFIG_REGISTRY: registry.url,
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = proc.stderr.text();
  const died = proc.exited.then(async code => {
    throw new Error(`the child exited (code ${code}, signal ${proc.signalCode}):\n${await stderr}`);
  });
  died.catch(() => {});

  const firstLine = await Promise.race([lines(proc.stdout).next(), died]);
  if (firstLine.done) await died;
  const { port } = JSON.parse(firstLine.value!) as { port: number };

  const sockets = await Promise.all(Array.from({ length: 20 }, () => connectTo(port)));
  try {
    // The status line and the body, once the server has closed the connection.
    const answers = sockets.map(socket => {
      const { promise, resolve } = Promise.withResolvers<string>();
      let received = "";
      socket.on("data", chunk => (received += chunk));
      socket.on("close", () => {
        const [head, body] = received.split("\r\n\r\n");
        resolve(`${head.split("\r\n")[0]}: ${body}`);
      });
      return promise;
    });
    const send = (socket: Socket) =>
      new Promise<void>((resolve, reject) =>
        socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", error =>
          error ? reject(error) : resolve(),
        ),
      );

    await send(sockets[0]);
    // The first handler is inside import() now, waiting for the registry.
    await Promise.race([gate.requested, died]);
    await Promise.all(sockets.slice(1).map(send));
    gate.release();

    const received = await Promise.race([Promise.all(answers), died]);
    proc.kill();
    expect({ received, stderr: await stderr }).toEqual({
      received: sockets.map(() => "HTTP/1.1 200 OK: imports 1"),
      stderr: "",
    });
  } finally {
    for (const socket of sockets) socket.destroy();
  }
});

// `git` for a git dependency is a child process on the event loop of the
// thread that installs, which is the JS loop here. A blocked thread cannot
// reap it. Auto-install cannot load a git dependency in any case, so it
// reports the package as not found and never starts git. Each repository
// below does not exist: a git child would say so on stderr.
describe.concurrent("auto-install does not start git", () => {
  test("for a git dependency of the project", async () => {
    using dir = tempDir("autoinstall-no-reentry-git", {
      "index.js": `
        let insideTheCall = true;
        const ranInsideTheCall = [];
        setTimeout(() => insideTheCall && ranInsideTheCall.push("timer"), 0);
        setImmediate(() => insideTheCall && ranInsideTheCall.push("immediate"));
        let code;
        try {
          require("git-dep");
          code = "resolved";
        } catch (error) {
          code = error.code;
        }
        insideTheCall = false;
        console.log(JSON.stringify({ code, ranInsideTheCall }));
      `,
    });
    const root = String(dir);
    await Bun.write(
      join(root, "package.json"),
      JSON.stringify({
        name: "app",
        dependencies: { "git-dep": `git+${pathToFileURL(join(root, "missing.git"))}#main` },
      }),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--install=force", "index.js"],
      cwd: root,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(root, ".bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: JSON.parse(stdout), stderr }).toEqual({
      stdout: { code: "MODULE_NOT_FOUND", ranInsideTheCall: [] },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("for a git dependency of an auto-installed package", async () => {
    const tarball = await Bun.file(join(import.meta.dir, "../../../cli/install/baz-0.0.3.tgz")).bytes();
    const integrity = "sha512-" + new Bun.CryptoHasher("sha512").update(tarball).digest("base64");

    using dir = tempDir("autoinstall-no-reentry-git-transitive", {
      "index.js": `
        require("baz");
        console.log("loaded");
      `,
    });
    const root = String(dir);

    await using registry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        const { pathname } = new URL(req.url);
        if (pathname === "/baz") {
          return Response.json({
            name: "baz",
            "dist-tags": { latest: "0.0.3" },
            versions: {
              "0.0.3": {
                name: "baz",
                version: "0.0.3",
                dependencies: { "git-dep": `git+${pathToFileURL(join(root, "missing.git"))}` },
                dist: { tarball: `http://127.0.0.1:${server.port}/baz/-/baz-0.0.3.tgz`, integrity },
              },
            },
          });
        }
        if (pathname === "/baz/-/baz-0.0.3.tgz") return new Response(tarball);
        return new Response("not found", { status: 404 });
      },
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--install=force", "index.js"],
      cwd: root,
      env: {
        ...bunEnv,
        BUN_CONFIG_REGISTRY: `http://127.0.0.1:${registry.port}/`,
        NPM_CONFIG_REGISTRY: `http://127.0.0.1:${registry.port}/`,
        BUN_INSTALL_CACHE_DIR: join(root, ".bun-cache"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // `baz` prints "run baz" when it loads.
    expect({ stdout, stderr }).toEqual({ stdout: "run baz\nloaded\n", stderr: "" });
    expect(exitCode).toBe(0);
  });
});
