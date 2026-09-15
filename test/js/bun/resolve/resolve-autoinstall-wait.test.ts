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
    stop: () => server.stop(true),
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
    const registry = makeRegistry();
    const gate = registry.gateFor(packageName);
    // An empty directory, so the resolver finds no node_modules above it.
    using dir = tempDir("resolve-autoinstall-wait", {});

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--install=force",
        join(import.meta.dir, "resolve-autoinstall-wait-fixture.ts"),
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
      stderr: "inherit",
    });

    const output = lines(proc.stdout);
    const { port } = JSON.parse((await output.next()).value!) as { port: number };

    const first = await connectTo(port);
    const second = await connectTo(port);
    try {
      await write(first, "/first", "first.example");
      // The handler is inside the call now, waiting for the registry.
      await gate.requested;
      await write(second, "/second", "second.example");
      gate.release();

      expect(JSON.parse((await output.next()).value!)).toEqual({
        url: "http://first.example/first",
        ranInsideTheCall: [],
      });
    } finally {
      first.destroy();
      second.destroy();
      registry.stop();
    }
  });
});

// `git` for a git dependency is a child process on the install thread's event
// loop, which is the JS loop here. A blocked thread cannot finish it, so a
// synchronous resolve reports the package as not found, like `--no-install`,
// instead of waiting. The clone carries on once the event loop runs again.
test("a git dependency that is not in the cache does not hang a synchronous resolve", async () => {
  using dir = tempDir("resolve-autoinstall-wait-git", {
    "app/index.js": `
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

  // A bare repository with one commit on `main`, made with two git processes.
  const gitEnv = { ...bunEnv, GIT_CONFIG_NOSYSTEM: "1" };
  const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`;
  const commit =
    "commit refs/heads/main\n" +
    "committer Test <test@example.com> 0 +0000\n" +
    data("init") +
    "M 100644 inline package.json\n" +
    data(JSON.stringify({ name: "git-dep", version: "1.0.0" })) +
    "M 100644 inline index.js\n" +
    data("module.exports = 1;\n") +
    "\n";
  for (const [cwd, cmd, stdin] of [
    [root, ["git", "init", "-q", "--bare", "repo.git"], ""],
    [join(root, "repo.git"), ["git", "fast-import", "--quiet"], commit],
  ] as const) {
    await using git = Bun.spawn({ cmd: [...cmd], cwd, env: gitEnv, stdin: Buffer.from(stdin), stderr: "inherit" });
    expect(await git.exited).toBe(0);
  }

  await Bun.write(
    join(root, "app", "package.json"),
    JSON.stringify({
      name: "app",
      dependencies: { "git-dep": `git+${pathToFileURL(join(root, "repo.git"))}#main` },
    }),
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=force", "index.js"],
    cwd: join(root, "app"),
    env: { ...gitEnv, BUN_INSTALL_CACHE_DIR: join(root, ".bun-cache") },
    stdout: "pipe",
    // The clone finishes or fails in the background and reports there.
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(JSON.parse(stdout)).toEqual({ code: "MODULE_NOT_FOUND", ranInsideTheCall: [] });
  expect(exitCode).toBe(0);
});
