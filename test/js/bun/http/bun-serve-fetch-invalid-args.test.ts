import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("server.fetch should reject invalid argument types without crashing", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("Hello World!");
    },
  });
  // @ts-expect-error
  await expect(server.fetch(1n)).rejects.toThrow("fetch() expects a string, but received BigInt");
  // @ts-expect-error
  await expect(server.fetch(Symbol("x"))).rejects.toThrow("fetch() expects a string, but received Symbol");
  // @ts-expect-error
  await expect(server.fetch(true)).rejects.toThrow("fetch() expects a string, but received Boolean");
  // @ts-expect-error
  await expect(server.fetch(1)).rejects.toThrow("fetch() expects a string, but received Number");
});

test("server.fetch rejects with the value thrown by the fetch handler", async () => {
  const error = Object.assign(new Error("handler threw"), { code: "E_HANDLER" });
  using server = Bun.serve({
    port: 0,
    fetch() {
      throw error;
    },
  });
  await expect(server.fetch("/")).rejects.toBe(error);

  using serverThrowingString = Bun.serve({
    port: 0,
    fetch() {
      throw "not an error";
    },
  });
  await expect(serverThrowingString.fetch("/")).rejects.toBe("not an error");
});

test("server.fetch rejects with an Error returned by the fetch handler", async () => {
  const error = new RangeError("handler returned an error");
  using server = Bun.serve({
    port: 0,
    fetch: (() => error) as any,
  });
  await expect(server.fetch("/")).rejects.toBe(error);
});

test("server.fetch rejects instead of throwing when the body cannot be converted", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("Hello World!");
    },
  });
  const error = new Error("body getter threw");
  const body: unknown[] = [];
  Object.defineProperty(body, 0, {
    get() {
      throw error;
    },
  });
  await expect(server.fetch("/", { body: body as any })).rejects.toBe(error);
});

// server.fetch() returns an already-rejected promise for all of these. Like any
// other rejected promise, it has to be reported when nothing handles it.
describe.concurrent("server.fetch early rejections are tracked", () => {
  const respond = `fetch() { return new Response("Hello World!"); }`;

  async function runChild(body: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", body],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.each([
    ["no arguments", respond, `server.fetch()`, "fetch() expects a string but received no arguments"],
    ["a blank URL", respond, `server.fetch("")`, "fetch() URL must not be a blank string"],
    ["a non-string argument", respond, `server.fetch(1)`, "fetch() expects a string, but received Number"],
    [
      "a server without a fetch handler",
      `routes: { "/": () => new Response("Hello World!") }`,
      `server.fetch("/")`,
      "fetch() requires the server to have a fetch handler",
    ],
    [
      "a fetch handler that throws",
      `fetch() { throw new Error("handler threw"); }`,
      `server.fetch("/")`,
      "handler threw",
    ],
    [
      "a fetch handler that returns an Error",
      `fetch() { return new RangeError("handler returned an error"); }`,
      `server.fetch("/")`,
      "handler returned an error",
    ],
    ["a fetch handler that returns undefined", `fetch() {}`, `server.fetch("/")`, "fetch() returned an empty value"],
    [
      "a body that cannot be converted",
      respond,
      `const body = []; Object.defineProperty(body, 0, { get() { throw new Error("body getter threw"); } }); server.fetch("/", { body })`,
      "body getter threw",
    ],
  ])("%s is reported as an unhandled rejection", async (_, serveOptions, call, expected) => {
    const { stderr, exitCode } = await runChild(`
      using server = Bun.serve({ port: 0, ${serveOptions} });
      ${call};
    `);
    expect(stderr).toContain(expected);
    expect(exitCode).toBe(1);
  });

  test("the returned promise is the one passed to 'unhandledRejection'", async () => {
    const { stdout, stderr, exitCode } = await runChild(`
      process.on("unhandledRejection", (reason, promise) => {
        console.log(reason.message, promise === p);
      });
      using server = Bun.serve({ port: 0, fetch() { throw new Error("handler threw"); } });
      const p = server.fetch("/");
    `);
    expect(stdout).toBe("handler threw true\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("a handled rejection is not reported", async () => {
    const { stdout, stderr, exitCode } = await runChild(`
      using server = Bun.serve({ port: 0, ${respond} });
      server.fetch().catch(e => console.log("caught:", e.message));
    `);
    expect(stdout).toBe("caught: fetch() expects a string but received no arguments.\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
