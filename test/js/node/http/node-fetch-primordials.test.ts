import { afterEach, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const originalResponse = globalThis.Response;
const originalRequest = globalThis.Request;
const originalHeaders = globalThis.Headers;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.Response = originalResponse;
  globalThis.Request = originalRequest;
  globalThis.Headers = originalHeaders;
  globalThis.fetch = originalFetch;
});

test("fetch, Response, Request can be overriden", async () => {
  const { Response, Request } = globalThis;
  globalThis.Response = class BadResponse {} as any;
  globalThis.Request = class BadRequest {} as any;
  globalThis.fetch = function badFetch() {} as any;

  const fetch = require("node-fetch").fetch;

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      return new Response("Hello, World!");
    },
  });

  const response = await fetch(server.url);
  expect(response).toBeInstanceOf(Response);
});

// The shims capture the native fetch when they load, so this must run in a fresh process.
test("replacing Bun.fetch does not change the fetch that node-fetch, undici, isomorphic-fetch and @vercel/fetch use", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { spyOn } = require("bun:test");
      const original = Bun.fetch;
      const undici = require("undici");
      const out = { undiciIsNativeAtStart: undici.fetch === original };

      Bun.fetch = () => { throw new Error("Bun.fetch replaced"); };
      globalThis.fetch = () => { throw new Error("globalThis.fetch replaced"); };
      const nodeFetch = require("node-fetch");
      const isomorphicFetch = require("isomorphic-fetch");
      const vercelFetch = require("@vercel/fetch")();

      using server = Bun.serve({ port: 0, fetch: () => new Response("native") });
      const bodies = [];
      for (const f of [nodeFetch.default, nodeFetch.fetch, isomorphicFetch, vercelFetch, undici.fetch]) {
        bodies.push(await (await f(server.url)).text());
      }
      out.bodies = bodies;
      out.undiciIsNativeAfterReplace = undici.fetch === original;
      out.undiciIsNotTheStub = undici.fetch !== Bun.fetch;

      Bun.fetch = original;
      const spy = spyOn(Bun, "fetch").mockImplementation(() => { throw new Error("mocked"); });
      out.mockedBody = await (await nodeFetch.default(server.url)).text();
      spy.mockRestore();
      out.restored = Bun.fetch === original;
      console.log(JSON.stringify(out));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    undiciIsNativeAtStart: true,
    bodies: ["native", "native", "native", "native", "native"],
    undiciIsNativeAfterReplace: true,
    undiciIsNotTheStub: true,
    mockedBody: "native",
    restored: true,
  });
  expect(exitCode).toBe(0);
});
