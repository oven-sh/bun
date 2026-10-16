import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Bun.serve() propagates errors to the parent fixture", async () => {
  const code = `import { test } from "bun:test";

test("Bun.serve() propagates errors to the parent", async () => {
  const server = Bun.serve({
    development: false,
    port: 0,
    fetch(req) {
      throw new Error("Test failed successfully");
    },
  });
  await fetch(server.url);
  server.stop(true);
});
`;
  await using dir = tempDir("propagate-errors", {
    "package.json": JSON.stringify({
      name: "test",
      version: "0.0.0",
      dependencies: {},
    }),
    "index.test.ts": code,
  });

  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "test"],
    cwd: dir,
    env: bunEnv,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "pipe",
  });

  expect(exitCode).toBe(1);
  expect(stderr.toString()).toContain("error: Test failed successfully");
});

// The server prints what a route or a body stream throws. Its [inspect.custom] must not leave an exception pending.
describe.concurrent("the server prints a thrown value whose inspection throws", () => {
  // The client is this process. So between two requests the server runs no JavaScript except its own timers.
  async function startServer(options: string) {
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import { inspect } from "node:util";
          const hostile = () => ({ [inspect.custom]() { throw new Error("inspect"); } });
          const entered = [];
          const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            development: false,
            ${options}
          });
          console.log(server.port);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const lines = (async function* () {
      let buffered = "";
      for await (const chunk of proc.stdout) {
        buffered += Buffer.from(chunk).toString();
        for (let end; (end = buffered.indexOf("\n")) !== -1; buffered = buffered.slice(end + 1)) {
          yield buffered.slice(0, end);
        }
      }
    })();
    const nextLine = async () => (await lines.next()).value ?? "the server exited";
    const port = Number(await nextLine());
    const request = (path: string) =>
      fetch(`http://127.0.0.1:${port}${path}`).then(
        async res => ({ status: res.status, body: await res.text() }),
        err => ({ failed: err.code ?? String(err) }),
      );
    // The handler of `path` calls server.stop(). A server that did not stop is killed, so that the test fails fast.
    const stop = async (path: string) => {
      const last = await request(path);
      if (!("status" in last) || last.status !== 200) proc.kill();
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      return { last, stderr, exitCode, signalCode: proc.signalCode };
    };
    return { proc, nextLine, request, stop };
  }

  test("a route throws or rejects with such a value: the next new timer callback runs", async () => {
    const shapes = {
      "throws an object that holds the value": `throw { status: 400, doc: hostile() };`,
      "rejects with an object that holds the value": `return Promise.reject({ status: 400, doc: hostile() });`,
      "throws an array that holds the value": `throw [1, hostile()];`,
      "throws a Map that holds the value": `throw new Map([["doc", hostile()]]);`,
      "throws an object that holds its Request, with the value in req.params": `req.params.doc = hostile(); throw { req };`,
    };
    // One route for each shape, so that each timer callback is a function that never ran before.
    const { proc, nextLine, request, stop } = await startServer(`
      routes: {
        "/end": () => {
          server.stop();
          return new Response("end");
        },
        ${Object.values(shapes)
          .map(
            (routeBody, i) => `
              "/bad/${i}/:id": req => {
                setTimeout(() => console.log("timer ${i}"), 1);
                ${routeBody}
              },
            `,
          )
          .join("")}
      },
    `);
    await using _ = proc;

    const results: Record<string, object> = {};
    for (const [i, does] of Object.keys(shapes).entries()) {
      const reply = await request(`/bad/${i}/1`);
      results[does] = { ...reply, timerLine: await nextLine() };
    }
    const { last: end, exitCode, signalCode } = await stop("/end");

    expect({ results, end, exitCode, signalCode }).toEqual({
      results: Object.fromEntries(
        Object.keys(shapes).map((does, i) => [
          does,
          { status: 500, body: "Something went wrong!", timerLine: `timer ${i}` },
        ]),
      ),
      end: { status: 200, body: "end" },
      // The server printed the errors of the routes.
      exitCode: 1,
      signalCode: null,
    });
  });

  test.each([
    { handler: "no error() handler", errorOption: `` },
    {
      handler: "an error() handler that throws such an object",
      errorOption: `error() { throw { status: 500, doc: hostile() }; },`,
    },
  ])(
    "a route throws an object that holds the value, $handler: the next requests reach their handlers",
    async ({ errorOption }) => {
      const { proc, request, stop } = await startServer(`
        ${errorOption}
        routes: {
          "/end": () => {
            server.stop();
            return Response.json(entered);
          },
          "/ok": () => {
            entered.push("/ok");
            return new Response("ok");
          },
          "/bad": () => {
            throw { status: 400, doc: hostile() };
          },
        },
      `);
      await using _ = proc;

      const replies = [];
      for (const path of ["/ok", "/bad", "/ok", "/ok"]) replies.push({ path, ...(await request(path)) });
      const { last: end, exitCode, signalCode } = await stop("/end");

      expect({ replies, end, exitCode, signalCode }).toEqual({
        replies: [
          { path: "/ok", status: 200, body: "ok" },
          { path: "/bad", status: 500, body: "Something went wrong!" },
          { path: "/ok", status: 200, body: "ok" },
          { path: "/ok", status: 200, body: "ok" },
        ],
        end: { status: 200, body: JSON.stringify(["/ok", "/ok", "/ok"]) },
        exitCode: 1,
        signalCode: null,
      });
    },
  );

  test("a direct stream body throws an object that holds the value: error() does not get that exception for the next request", async () => {
    const { proc, request, stop } = await startServer(`
      error(err) {
        entered.push("error(): " + (err?.message ?? typeof err));
        return new Response("error(): " + (err?.message ?? typeof err), { status: 500 });
      },
      routes: {
        "/end": () => {
          server.stop();
          return Response.json(entered);
        },
        "/ok": () => {
          entered.push("/ok");
          return new Response("ok");
        },
        "/bad": () =>
          new Response(
            new ReadableStream({
              type: "direct",
              pull(controller) {
                controller.write("a");
                throw { status: 400, doc: hostile() };
              },
            }),
          ),
      },
    `);
    await using _ = proc;

    // The body fails after the status line. The reply to this request is not the subject.
    await request("/bad");
    const ok = [await request("/ok"), await request("/ok")];
    const { last: end, exitCode, signalCode } = await stop("/end");

    expect({ ok, end, exitCode, signalCode }).toEqual({
      ok: [
        { status: 200, body: "ok" },
        { status: 200, body: "ok" },
      ],
      end: { status: 200, body: JSON.stringify(["/ok", "/ok"]) },
      exitCode: 0,
      signalCode: null,
    });
  });
});
