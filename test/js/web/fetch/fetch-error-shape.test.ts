import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// fetch() network errors must be TypeError('fetch failed') with a `.cause`
// carrying the underlying error (matching Node.js / undici), a non-empty
// string `.stack` pointing at the caller, and a Node-compatible errno `.code`
// on the cause. Bun also keeps `.code` on the outer TypeError for backwards
// compatibility so `err.code === "ECONNREFUSED"` keeps working.

function expectFetchFailed(err: unknown, code: string) {
  expect(err).toBeInstanceOf(TypeError);
  const e = err as TypeError & { code?: string; cause?: Error & { code?: string } };
  expect(e.name).toBe("TypeError");
  expect(e.message).toBe("fetch failed");
  expect(typeof e.stack).toBe("string");
  expect(e.stack).toContain("fetch-error-shape.test.ts");
  expect(e.cause).toBeInstanceOf(Error);
  expect(e.cause?.code).toBe(code);
  // compat bridge: outer error also carries .code
  expect(e.code).toBe(code);
}

describe("fetch network error shape", () => {
  test("ECONNREFUSED: TypeError('fetch failed') with cause.code", async () => {
    // Bind to a port then close it so nothing is listening.
    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    const port = server.port;
    server.stop(true);

    let caught: unknown;
    try {
      await fetch(`http://127.0.0.1:${port}/`);
    } catch (e) {
      caught = e;
    }
    expectFetchFailed(caught, "ECONNREFUSED");
    const e = caught as Error & { path?: string; cause?: Error & { path?: string } };
    expect(e.cause?.path).toBe(`http://127.0.0.1:${port}/`);
  });

  test("ECONNRESET: server closes mid-handshake", async () => {
    await using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          // RST before any HTTP bytes.
          socket.terminate();
        },
        data() {},
      },
    });
    let caught: unknown;
    try {
      await fetch(`http://127.0.0.1:${server.port}/`);
    } catch (e) {
      caught = e;
    }
    expectFetchFailed(caught, "ECONNRESET");
  });

  test("DNS failure carries hostname/syscall on cause", async () => {
    // Spawn with proxy env cleared so the lookup actually runs.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `fetch("http://does.not.exist.invalid/").catch(e => {
           process.stdout.write(JSON.stringify({
             name: e.name,
             message: e.message,
             causeSyscall: e.cause && e.cause.syscall,
             causeHostname: e.cause && e.cause.hostname,
             causeCode: e.cause && e.cause.code,
           }));
         });`,
      ],
      env: { ...bunEnv, HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // resolver-dependent code (ENOTFOUND, EAI_AGAIN, ENOTIMP, ...); assert shape only
    expect({ out: JSON.parse(stdout), stderr, exitCode }).toEqual({
      out: {
        name: "TypeError",
        message: "fetch failed",
        causeSyscall: "getaddrinfo",
        causeHostname: "does.not.exist.invalid",
        causeCode: expect.any(String),
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test(".catch() consumer still gets a stack", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `fetch("http://127.0.0.1:1/").catch(e => {
           process.stdout.write(JSON.stringify({
             name: e.name,
             message: e.message,
             stackIsString: typeof e.stack === "string",
             stackHasEval: typeof e.stack === "string" && e.stack.includes("[eval]"),
             code: e.code,
             causeCode: e.cause && e.cause.code,
           }));
         });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const out = JSON.parse(stdout);
    expect(out.name).toBe("TypeError");
    expect(out.message).toBe("fetch failed");
    expect(out.stackIsString).toBe(true);
    expect(out.stackHasEval).toBe(true);
    expect(out.code).toBe("ECONNREFUSED");
    expect(out.causeCode).toBe("ECONNREFUSED");
    expect(exitCode).toBe(0);
  });

  test("is-network-error heuristic matches", async () => {
    // https://github.com/sindresorhus/is-network-error
    // Checks: err instanceof TypeError && message in {'fetch failed', ...}
    let caught: unknown;
    try {
      await fetch("http://127.0.0.1:1/");
    } catch (e) {
      caught = e;
    }
    const e = caught as Error;
    const looksLikeNetworkError =
      Object.prototype.toString.call(e) === "[object Error]" &&
      e.name === "TypeError" &&
      ["fetch failed", "terminated"].includes(e.message);
    expect(looksLikeNetworkError).toBe(true);
  });
});
