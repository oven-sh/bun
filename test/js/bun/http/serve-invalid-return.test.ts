import { serve } from "bun";
import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A fetch handler that returns a truthy value that is not a `Response` (a
// plain object, a string, a number, ...) must invoke the error handler and
// respond 500, the same as a thrown error, instead of silently sending a
// cacheable 2xx with an empty body.
describe("returning a non-Response value from fetch", () => {
  const invalidReturnError = {
    code: "ERR_INVALID_RETURN_VALUE",
    name: "TypeError",
  };

  const invalidValues = {
    "plain object": () => ({ forgot: "new Response" }),
    "string": () => "plain string",
    "number": () => 42,
    "symbol": () => Symbol("invalid response type"),
  };

  it.each(Object.keys(invalidValues) as (keyof typeof invalidValues)[])(
    "returning a %s calls the error handler and responds with its Response",
    async kind => {
      const make = invalidValues[kind];
      // The same value goes down three distinct native paths: a synchronous
      // return, an already-fulfilled promise, and a promise resolved later.
      const handlers = {
        "sync": () => make(),
        "fulfilled": () => Promise.resolve(make()),
        // The server drains microtasks before unwrapping the returned promise,
        // so a microtask-resolved promise collapses into "fulfilled". Only a
        // macrotask keeps it pending long enough to reach the deferred path.
        "deferred": () => new Promise(resolve => setImmediate(() => resolve(make()))),
      };

      const results: unknown[] = [];
      for (const [path, fetchImpl] of Object.entries(handlers)) {
        let error: unknown = null;
        await using server = serve({
          port: 0,
          // @ts-ignore the invalid return value is the point
          fetch: fetchImpl,
          error(err: any) {
            error = { code: err.code, name: err.constructor.name };
            return new Response("handled", { status: 500 });
          },
        });
        const response = await fetch(server.url);
        results.push({ path, status: response.status, body: await response.text(), error });
      }

      const handled = { status: 500, body: "handled", error: invalidReturnError };
      expect(results).toEqual([
        { path: "sync", ...handled },
        { path: "fulfilled", ...handled },
        { path: "deferred", ...handled },
      ]);
    },
  );

  it("the error names the value that was returned", async () => {
    let error: any;
    await using server = serve({
      port: 0,
      // @ts-ignore
      fetch: () => 42,
      error(err: any) {
        error = err;
        return new Response("handled", { status: 500 });
      },
    });
    await (await fetch(server.url)).text();
    expect(error.message).toBe("Expected a Response object, but received '42'");
  });

  // `undefined` and `null` mean the handler produced no response; that is not
  // an error, and production still renders an empty 204.
  it.each([
    ["undefined", () => undefined],
    ["null", () => null],
    ["undefined from an async handler", async () => undefined],
  ])("returning %s does not call the error handler", async (_name, fetchImpl) => {
    const error = jest.fn();
    await using server = serve({
      port: 0,
      development: false,
      // @ts-ignore
      fetch: fetchImpl,
      error,
    });

    const response = await fetch(server.url);
    expect(await response.text()).toBe("");
    expect(response.status).toBe(204);
    expect(error).not.toHaveBeenCalled();
  });

  it("without an error handler, logs the error and responds with 500", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const server = Bun.serve({
          port: 0,
          development: false,
          fetch() {
            return { forgot: "new Response" };
          },
        });
        const res = await fetch(server.url);
        console.log(res.status, JSON.stringify(await res.text()));
        server.stop(true);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe('500 "Something went wrong!"\n');
    expect(stderr).toContain("Expected a Response object, but received");
    // The invalid return is reported like any other unhandled error thrown
    // from the fetch handler.
    expect(exitCode).toBe(1);
  });
});
