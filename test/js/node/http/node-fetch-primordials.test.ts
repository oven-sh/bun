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
      `Bun.fetch = () => { throw new Error("Bun.fetch replaced"); };
      globalThis.fetch = () => { throw new Error("globalThis.fetch replaced"); };
      const undici = require("undici");
      const nodeFetch = require("node-fetch");
      const isomorphicFetch = require("isomorphic-fetch");
      const vercelFetch = require("@vercel/fetch")();

      using server = Bun.serve({ port: 0, fetch: () => new Response("native") });
      const bodies = [];
      for (const f of [undici.fetch, nodeFetch.default, nodeFetch.fetch, isomorphicFetch, vercelFetch]) {
        bodies.push(await (await f(server.url)).text());
      }
      console.log(JSON.stringify({ bodies, preconnect: typeof undici.fetch.preconnect }));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    bodies: ["native", "native", "native", "native", "native"],
    preconnect: "function",
  });
  expect(exitCode).toBe(0);
});
