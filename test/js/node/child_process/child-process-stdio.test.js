import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { execSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { closeSync, openSync, readFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { join } from "node:path";

const CHILD_PROCESS_FILE = import.meta.dir + "/spawned-child.js";
const OUT_FILE = import.meta.dir + "/stdio-test-out.txt";

describe("process.stdout", () => {
  it("should allow us to write to it", done => {
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDOUT"], {
      env: bunEnv,
      stdio: ["inherit", "pipe", "inherit"],
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", data => {
      try {
        expect(data).toBe("stdout_test");
        done();
      } catch (err) {
        done(err);
      }
    });
  });
});

describe("process.stdin", () => {
  it("should allow us to read from stdin in readable mode", done => {
    const input = "hello there\n";
    // Child should read from stdin and write it back
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "READABLE"], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit"],
    });
    let data = "";
    child.stdout.setEncoding("utf8");
    child.stdout
      .on("data", chunk => {
        data += chunk;
      })
      .on("end", function () {
        try {
          expect(data).toBe(`data: ${input}`);
          done();
        } catch (err) {
          done(err);
        }
      });
    child.stdin.write(input, function () {
      child.stdin.end(...arguments);
    });
  });

  it("should allow us to read from stdin via flowing mode", done => {
    const input = "hello\n";
    // Child should read from stdin and write it back
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "FLOWING"], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit"],
    });
    let data = "";
    child.stdout.setEncoding("utf8");
    child.stdout
      .on("readable", () => {
        let chunk;
        while ((chunk = child.stdout.read()) !== null) {
          data += chunk;
        }
      })
      .on("end", function () {
        try {
          expect(data).toBe(`data: ${input}`);
          done();
        } catch (err) {
          done(err);
        }
      });
    child.stdin.end(input);
  });

  it("should allow us to read > 65kb from stdin", done => {
    const numReps = Math.ceil((1024 * 1024) / 5);
    const input = Buffer.alloc("hello".length * numReps)
      .fill("hello")
      .toString();
    // Child should read from stdin and write it back
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "FLOWING"], {
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stdio: ["pipe", "pipe", "inherit"],
    });
    let data = "";
    child.stdout.setEncoding("utf8");
    child.stdout
      .on("readable", () => {
        let chunk;
        while ((chunk = child.stdout.read()) !== null) {
          data += chunk;
        }
      })
      .on("end", function () {
        try {
          const expected = "data: " + input;
          expect(data.length).toBe(expected.length);
          expect(data).toBe(expected);
          done();
        } catch (err) {
          done(err);
        }
      });
    child.stdin.end(input);
  });

  it("should allow us to read from a file", () => {
    const result = execSync(`${bunExe()} ${CHILD_PROCESS_FILE} STDIN FLOWING < ${import.meta.dir}/readFileSync.txt`, {
      encoding: "utf8",
      env: bunEnv,
    });
    expect(result).toEqual("data: File read successfully");
  });
});

describe("child.stdin", () => {
  it("write() after child 'close' returns false and calls back with ERR_STREAM_DESTROYED", async () => {
    const child = spawn(bunExe(), ["-e", ""], {
      env: bunEnv,
      stdio: ["pipe", "ignore", "ignore"],
    });
    await once(child, "close");

    const { promise, resolve } = Promise.withResolvers();
    const ret = child.stdin.write("dropped", resolve);
    const cbErr = await promise;

    expect({
      ret,
      cbCode: cbErr?.code,
      destroyed: child.stdin.destroyed,
      writable: child.stdin.writable,
    }).toEqual({
      ret: false,
      cbCode: "ERR_STREAM_DESTROYED",
      destroyed: true,
      writable: false,
    });
  });

  it("write() after child 'exit' (before 'close') returns false and calls back with ERR_STREAM_DESTROYED", async () => {
    const child = spawn(bunExe(), ["-e", "process.stdin.once('data', () => process.exit(0))"], {
      env: bunEnv,
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.stdin.on("error", () => {});
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.stdin.write("go\n", err => (err ? reject(err) : resolve()));
    });
    await once(child, "exit");

    const { promise, resolve } = Promise.withResolvers();
    const ret = child.stdin.write("late", resolve);
    const cbErr = await promise;

    expect({ ret, cbCode: cbErr?.code }).toEqual({
      ret: false,
      cbCode: "ERR_STREAM_DESTROYED",
    });
  });
});

// Node shares the descriptor of any stdio entry that has a numeric `fd`
// property (lib/internal/child_process.js, getValidStdio): handle wraps,
// FileHandles, fs/tty streams, plain { fd } objects. Its own test-listen-fd-*
// tests rely on that to hand `server._handle` to a child as fd 3; in Bun that
// handle is the Bun.listen() Listener, which exposes `fd`. Socket descriptors
// cannot be inherited as stdio on Windows (same as Node), so the cases that
// actually inherit a socket are POSIX only.
describe("stdio entries carrying a file descriptor", () => {
  async function listeningServer(onConnection) {
    const server = createServer(onConnection);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    return { server, port: server.address().port };
  }

  it.skipIf(isWindows)("a listening server's handle is inherited by the child as that fd", async () => {
    const { server, port } = await listeningServer(conn => conn.end("hello from parent"));
    let child;
    try {
      child = spawn(
        bunExe(),
        [
          "-e",
          `require("net").createServer(c => c.end("hello from child")).listen({ fd: 3 }, () => console.log("listening"));`,
        ],
        { env: bunEnv, stdio: ["ignore", "pipe", "inherit", server._handle] },
      );
      // Like Node, a shared descriptor gets no stream in child.stdio.
      expect(child.stdio[3]).toBeNull();

      // Close the parent's copy so the child's inherited descriptor is the only
      // thing keeping the port open.
      const closed = once(server, "close");
      server.close();
      await closed;

      let out = "";
      await new Promise((resolve, reject) => {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", chunk => {
          out += chunk;
          if (out.includes("listening")) resolve();
        });
        child.once("error", reject);
        child.once("exit", (code, signal) =>
          reject(new Error(`child exited (${code ?? signal}) before listening: ${out}`)),
        );
      });

      const reply = await new Promise((resolve, reject) => {
        const socket = connect({ port, host: "127.0.0.1" });
        let data = "";
        socket.setEncoding("utf8");
        socket.on("data", chunk => (data += chunk));
        socket.once("end", () => resolve(data));
        socket.once("error", reject);
      });
      expect(reply).toBe("hello from child");
    } finally {
      child?.kill();
      server.close();
    }
  });

  it.skipIf(isWindows)("spawnSync shares listening and connected socket handles with the child", async () => {
    // The server leaves the connection open so the client's handle is still
    // live while the child is spawned.
    const { server, port } = await listeningServer(() => {});
    const client = connect({ port, host: "127.0.0.1" });
    try {
      await once(client, "connect");
      const { stdout, status } = spawnSync(
        bunExe(),
        [
          "-e",
          `const { fstatSync } = require("fs"); console.log(JSON.stringify([3, 4].map(fd => fstatSync(fd).isSocket())));`,
        ],
        {
          env: bunEnv,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit", server._handle, client._handle],
        },
      );
      expect(stdout).toBe("[true,true]\n");
      expect(status).toBe(0);
    } finally {
      client.destroy();
      server.close();
    }
  });

  it.each([
    [
      "a plain { fd } object",
      file => {
        const fd = openSync(file, "w");
        return { entry: { fd }, close: () => closeSync(fd) };
      },
    ],
    [
      "a FileHandle",
      async file => {
        const handle = await open(file, "w");
        return { entry: handle, close: () => handle.close() };
      },
    ],
  ])("%s as stdout makes the child write to that descriptor", async (_label, prepare) => {
    using dir = tempDir("stdio-fd-object", {});
    const file = join(String(dir), "stdout.txt");
    const { entry, close } = await prepare(file);
    let status;
    try {
      ({ status } = spawnSync(bunExe(), ["-e", `console.log("written through the shared fd")`], {
        env: bunEnv,
        stdio: ["ignore", entry, "inherit"],
      }));
    } finally {
      await close();
    }
    expect(readFileSync(file, "utf8")).toBe("written through the shared fd\n");
    expect(status).toBe(0);
  });

  it.each([
    ["an object without an fd", {}],
    ["an object whose fd is not a number", { fd: "3" }],
  ])("%s is still rejected before anything is spawned", (_label, entry) => {
    const options = { env: bunEnv, stdio: ["ignore", "ignore", "ignore", entry] };
    expect(() => spawn(bunExe(), ["-e", "0"], options)).toThrow(/stdio/);
    expect(() => spawnSync(bunExe(), ["-e", "0"], options)).toThrow(/stdio/);
  });

  it("a handle whose descriptor is already closed is refused, like passing its fd directly", async () => {
    const { server } = await listeningServer(() => {});
    const handle = server._handle;
    const closed = once(server, "close");
    server.close();
    await closed;
    expect(handle.fd).toBe(-1);

    // The handle is only sugar for its `.fd`, so this takes the path a bare -1
    // takes: Bun.spawn refuses the descriptor (spawn() throws, spawnSync()
    // returns the error). Node's libuv layer instead spawns the child with
    // the slot left closed for the negative errno a closed wrap reports
    // (EINVAL only for exactly -1); silently dropping the socket is not worth
    // reproducing.
    const optionsFor = entry => ({ env: bunEnv, stdio: ["ignore", "ignore", "ignore", entry] });
    const spawnFailure = entry => {
      try {
        spawn(bunExe(), ["-e", "0"], optionsFor(entry));
      } catch (error) {
        return { code: error.code, message: error.message };
      }
    };
    const spawnSyncFailure = entry => {
      const { error } = spawnSync(bunExe(), ["-e", "0"], optionsFor(entry));
      return error && { code: error.code, message: error.message };
    };

    const viaHandle = spawnFailure(handle);
    expect(viaHandle).toBeDefined();
    expect(viaHandle).toEqual(spawnFailure(handle.fd));

    const viaHandleSync = spawnSyncFailure(handle);
    expect(viaHandleSync).toBeDefined();
    expect(viaHandleSync).toEqual(spawnSyncFailure(handle.fd));
  });
});
