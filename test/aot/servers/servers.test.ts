// Opt-in test. Ten HTTP servers implement the same routes, each written the way a user of that framework would write it:
// Bun.serve, a thin typed framework over it (./app/thin-framework.ts), Hono, Elysia, node:http, Koa, Express, Fastify without and with schemas (./app/<name>.ts on top of ./app/shared.ts), and TanStack Start
// (./tanstack, built with vite first, using the same shared.ts). Each one is built with `bun build --compile --aot`, startServer,
// and sent requests. ./answers.ts has the expected responses.
//
//   every route                    status 200, the Content-Type and the exact body: once, then a few thousand times over
//                                  keep-alive connections, then again with the RegExp JIT off, with the GC running
//                                  continuously, and with a GC every few allocations that scribbles over dead cells
//   the two validating routes      400 for every invalid order in ./answers.ts (one validates with zod, one by hand)
//   the route that only casts      the same status as Bun without --aot for each invalid order
//   an unknown path                404
//   array storage                  a new array still has contiguous storage afterwards (the realm is not "having a bad time")
//   edge-case requests             same status, headers and body as the same server compiled without --aot
//   TanStack Start pages           same HTML as Bun without --aot
//   other build options            same answers with --trim, with --disallow-code-generation-from-strings, and with both
// ./go (net/http) and ./rust (axum) implement six of the routes. ./measure compares against them, so they are checked too.
//
//   AOT_SERVERS=1 bun test test/aot/servers                 all ten (about two minutes, mostly `bun install`)
//   AOT_SERVERS=express,fastify bun test test/aot/servers   only these
//   AOT_SERVERS=go,rust bun test test/aot/servers           the two native servers; `cargo build` downloads crates
//   AOT_SERVERS_MODULES=<node_modules folder> ..            use packages that are already installPackages; nothing is downloaded
//
// Everything is skipped unless AOT_SERVERS is set, because the packages in ./app/package.json and ./tanstack/package.json are
// downloaded from npm.
// ./measure has the load-testing tools for the same servers; see the docstring of ./measure/measure.py.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { canTrim } from "../../bundler/compile-trim-features";
import { built, spawned, unsupported } from "../run-programs";
import { invalidOrderBody, invalidOrders, routes, type Route } from "./answers";
import { filterRequested, installPackages, removeFolders, requestedServers, startServer } from "./run-servers";

const servers = filterRequested([
  "bun",
  "thin",
  "hono",
  "elysia",
  "node",
  "koa",
  "express",
  "fastify",
  "fastify-schemas",
  "tanstack",
]);

const generatesHandlersFromStrings = ["elysia", "koa", "fastify", "fastify-schemas"];

const json = { "Content-Type": "application/json" };
const order = routes.find(route => route.name === "post")!.request!;
const edgeCaseRequests: [method: string, path: string, init?: { headers?: Record<string, string>; body?: string }][] = [
  ["HEAD", "/text"],
  ["HEAD", "/json"],
  ["HEAD", "/stream"],
  ["OPTIONS", "/text"],
  ["POST", "/text"],
  ["PUT", "/shops/west/orders", { headers: json, body: order }],
  ["DELETE", "/json"],
  ["GET", "/text/"],
  ["GET", "//text"],
  ["GET", "/TEXT"],
  ["GET", "/text?a=1&a=2&b"],
  ["GET", "/text%20"],
  ["GET", "/json", { headers: { "Accept-Encoding": "gzip" } }],
  ["GET", "/json", { headers: { "If-None-Match": "*" } }],
  ["GET", "/json", { headers: { Accept: "text/html" } }],
  ["GET", "/users/42/posts/"],
  ["GET", "/users//posts/first"],
  ["GET", "/users/42/posts/first/more"],
  ["GET", "/users/%34%32/posts/hello%20world?page=abc&limit=1000&sort="],
  ["GET", "/users/42/posts/caf%C3%A9?page=-1&limit=0&sort=%F0%9F%8D%9E"],
  ["GET", "/users/42/posts/a%2Fb?page=1e1&limit=0x10"],
  ["GET", "/users/42/posts/%E0%A4%A"],
  ["GET", "/users/42/posts/first?page=2&page=3&sort[]=top"],
  ["GET", "/users/forty-two/posts/first"],
  ["GET", "/async/1"],
  ["GET", "/async/100"],
  ["GET", "/async/101"],
  ["GET", "/async/abc"],
  ["GET", "/async/4.5"],
  ["GET", "/async/-1"],
  ["POST", "/shops/west/orders"],
  ["POST", "/shops/west/orders", { headers: json, body: "" }],
  ["POST", "/shops/west/orders", { headers: json, body: "null" }],
  ["POST", "/shops/west/orders", { headers: json, body: "[]" }],
  ["POST", "/shops/west/orders", { headers: json, body: '"text"' }],
  ["POST", "/shops/west/orders", { headers: json, body: " " + order + "\n" }],
  ["POST", "/shops/west/orders", { headers: { "Content-Type": "text/plain" }, body: order }],
  ["POST", "/shops/west/orders", { headers: { "Content-Type": "application/json; charset=utf-8" }, body: order }],
  [
    "POST",
    "/shops/west/orders",
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "coupon=TENOFF" },
  ],
  ["POST", `/shops/${"w".repeat(32)}/orders`, { headers: json, body: order }],
  ["POST", `/shops/${"w".repeat(33)}/orders`, { headers: json, body: order }],
  ["POST", "/shops/w%C3%A9st/orders", { headers: json, body: order }],
  [
    "POST",
    "/shops/west/orders",
    {
      headers: json,
      body: JSON.stringify({ ...JSON.parse(order), items: Array(101).fill(JSON.parse(order).items[0]) }),
    },
  ],
  [
    "POST",
    "/shops/west/orders",
    { headers: json, body: JSON.stringify({ ...JSON.parse(order), coupon: "x".repeat(200_000) }) },
  ],
  ["POST", "/shops/west/orders", { headers: json, body: order.replace('"id":4711', '"id":4711,"id":4712') }],
  ["POST", "/shops/west/orders", { headers: json, body: order.replace('"id":4711', '"__proto__":{"id":1},"id":4711') }],
  ["POST", "/shops/west/checked-orders", { headers: json, body: order.replace('"id":4711', '"id":1e400') }],
  ["POST", "/shops/west/checked-orders", { headers: json, body: order.replace('"id":4711', '"id":9007199254740993') }],
  [
    "POST",
    "/shops/west/typed-orders",
    { headers: json, body: order.replace('"coupon":"TENOFF"', '"coupon":"tenoff"') },
  ],
];

async function sendRequest(origin: string, route: Route, request = route.request) {
  const response = await fetch(origin + route.path, {
    redirect: "manual",
    method: route.method,
    body: request,
    headers: request === undefined ? {} : { "Content-Type": "application/json" },
  });
  return {
    status: response.status,
    type: response.headers.get("Content-Type")?.split(";")[0]!.trim().toLowerCase(),
    body: await response.text(),
  };
}

if (!requestedServers)
  console.error(
    "SKIPPED: test/aot/servers/servers.test.ts: it installs packages from npm. Set AOT_SERVERS=1 to run it",
  );

describe.skipIf(!requestedServers || !!unsupported)("compile/aot/servers", () => {
  const app = String(tempDir("aot-servers", {}));
  const tanstack = String(tempDir("aot-servers-tanstack", {}));
  // Each executable is as large as Bun itself.
  afterAll(() => removeFolders(app, tanstack));

  beforeAll(async () => {
    if (servers.some(name => name !== "tanstack")) {
      cpSync(join(import.meta.dir, "app"), app, { recursive: true });
      await installPackages(app);
    }
    if (servers.includes("tanstack")) {
      cpSync(join(import.meta.dir, "tanstack"), tanstack, { recursive: true });
      cpSync(join(import.meta.dir, "app", "shared.ts"), join(tanstack, "src", "utils", "shared.ts"));
      await installPackages(tanstack);
      const vite = await spawned([bunExe(), "node_modules/vite/bin/vite.js", "build"], tanstack, bunEnv);
      expect({ output: vite.stdout + vite.stderr, exitCode: vite.exitCode }).toEqual({
        output: expect.any(String),
        exitCode: 0,
      });
    }
  }, 300_000);

  describe.each(servers)("%s", name => {
    const folder = name === "tanstack" ? tanstack : app;
    const entry = name === "tanstack" ? "./serve.ts" : `./${name}.ts`;
    // The bundler inlines process.env.NODE_ENV and defaults it to "development", which would select React's development build and
    // make Express include stack traces in error responses.
    const flags = ["--define", 'process.env.NODE_ENV="production"'];
    const executable = join(folder, `${name}-compiled${isWindows ? ".exe" : ""}`);
    const startCompiled = (env: Record<string, string> = {}) =>
      startServer([executable], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", ...env });

    beforeAll(async () => {
      const build = await spawned(
        [bunExe(), "build", "--compile", "--aot", ...flags, "--target=bun", entry, "--outfile", executable],
        folder,
        bunEnv,
      );
      built(build);
    }, 120_000);

    test("serves every route", async () => {
      using server = await startCompiled();
      for (const route of routes) {
        expect({ route: route.name, ...(await sendRequest(server.origin, route)) }).toEqual({
          route: route.name,
          status: 200,
          type: route.type,
          body: route.expectedBody,
        });
      }
      expect((await fetch(server.origin + "/nothing")).status).toBe(404);
    });

    // Express and Hono match paths with regular expressions created at run time, so both RegExp engines must agree.
    test.each([
      ["serves every route after a few thousand requests", {}],
      ["serves every route with the RegExp JIT off", { BUN_JSC_useRegExpJIT: "0" }],
      ["serves every route with the GC running continuously", { BUN_JSC_collectContinuously: "1" }],
      [
        "serves every route in zombie mode",
        { BUN_JSC_useZombieMode: "1", BUN_JSC_sweepSynchronously: "1", BUN_JSC_slowPathAllocsBetweenGCs: "50" },
      ],
    ])(
      "%s",
      async (_, env) => {
        using server = await startCompiled(env);
        for (const route of routes) {
          const expected = { status: 200, type: route.type, body: route.expectedBody };
          let mismatch: unknown;
          await Promise.all(
            Array.from({ length: 16 }, async () => {
              for (let n = 0; n < 200 && !mismatch; n++) {
                const response = await sendRequest(server.origin, route);
                if (!Bun.deepEquals(response, expected)) mismatch = response;
              }
            }),
          );
          expect({ route: route.name, mismatch }).toEqual({ route: route.name, mismatch: undefined });
        }
      },
      240_000,
    );

    // JSGlobalObject::haveABadTime() permanently switches every array in the realm to SlowPutArrayStorage. It fires when an object
    // that may have indexed accessors enters a prototype chain. ES5-style inheritance between functions (util.inherits, transpiled
    // classes) must not trigger it.
    test("does not trigger haveABadTime", async () => {
      const indexingTypePath = join(folder, `${name}-array-kind.txt`);
      writeFileSync(
        join(folder, `${name}-probe.ts`),
        `${readFileSync(join(folder, entry), "utf8")}
import { jscDescribe } from "bun:jsc";
import { writeFileSync } from "node:fs";
setInterval(() => writeFileSync(${JSON.stringify(indexingTypePath)}, /ArrayWith[A-Za-z]+/.exec(jscDescribe([1, {}]))![0]), 20);
`,
      );
      const probe = join(folder, `${name}-probe${isWindows ? ".exe" : ""}`);
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", ...flags, "--target=bun", `./${name}-probe.ts`, "--outfile", probe],
          folder,
          bunEnv,
        ),
      );
      using server = await startServer([probe], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      for (const route of routes)
        for (let n = 0; n < 20; n++) expect((await sendRequest(server.origin, route)).status).toBe(200);
      rmSync(indexingTypePath, { force: true });
      while (!existsSync(indexingTypePath) || !readFileSync(indexingTypePath, "utf8")) await Bun.sleep(5);
      expect(readFileSync(indexingTypePath, "utf8")).toBe("ArrayWithContiguous");
    }, 120_000);

    test("rejects invalid orders", async () => {
      using server = await startCompiled();
      using reference = await startServer([bunExe(), entry], folder, bunEnv);
      const actual: Record<string, number> = {};
      const expected: Record<string, number> = {};
      for (const route of routes.filter(route => route.method === "POST")) {
        for (const [description, request] of Object.entries(invalidOrders)) {
          const { status, body } = await sendRequest(server.origin, route, request);
          actual[`${route.name}: ${description}`] = status;
          expected[`${route.name}: ${description}`] =
            route.name === "typed" ? (await sendRequest(reference.origin, route, request)).status : 400;
          if (description === "a quantity of zero") expect(body).toBe(invalidOrderBody);
        }
        expect({ route: route.name, ...(await sendRequest(server.origin, route)) }).toEqual({
          route: route.name,
          status: 200,
          type: route.type,
          body: route.expectedBody,
        });
      }
      expect(actual).toEqual(expected);
    });

    test.each([
      { options: ["--disallow-code-generation-from-strings"], needsTrimming: false },
      { options: ["--trim"], needsTrimming: true },
      { options: ["--trim", "--disallow-code-generation-from-strings"], needsTrimming: true },
    ])(
      "answers the same when built with $options",
      async ({ options, needsTrimming }) => {
        if (needsTrimming && !canTrim) return;
        if (generatesHandlersFromStrings.includes(name) && options.includes("--disallow-code-generation-from-strings"))
          return;
        const variant = join(folder, `${name}-variant${isWindows ? ".exe" : ""}`);
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              ...options,
              ...flags,
              "--target=bun",
              entry,
              "--outfile",
              variant,
            ],
            folder,
            bunEnv,
          ),
        );
        using server = await startServer([variant], folder, bunEnv);
        using reference = await startCompiled();
        for (const route of routes) {
          expect({ route: route.name, ...(await sendRequest(server.origin, route)) }).toEqual({
            route: route.name,
            status: 200,
            type: route.type,
            body: route.expectedBody,
          });
        }
        for (const route of routes.filter(route => route.method === "POST")) {
          for (const [description, request] of Object.entries(invalidOrders)) {
            const expected = await sendRequest(reference.origin, route, request);
            expect({ route: route.name, description, ...(await sendRequest(server.origin, route, request)) }).toEqual({
              route: route.name,
              description,
              ...expected,
            });
          }
        }
        expect((await fetch(server.origin + "/nothing")).status).toBe(404);
      },
      240_000,
    );

    test("handles edge-case requests like a build without --aot", async () => {
      const withoutAot = join(folder, `${name}-no-aot${isWindows ? ".exe" : ""}`);
      built(
        await spawned(
          [bunExe(), "build", "--compile", ...flags, "--target=bun", entry, "--outfile", withoutAot],
          folder,
          bunEnv,
        ),
      );
      using server = await startCompiled();
      using reference = await startServer([withoutAot], folder, bunEnv);
      const collectResponses = async (origin: string) => {
        const all: Record<string, { status: number; headers: string[][]; body: string }> = {};
        for (const [method, path, init] of edgeCaseRequests) {
          const response = await fetch(origin + path, { method, redirect: "manual", ...init });
          all[`${method} ${path} ${JSON.stringify(init?.headers ?? {})} ${String(init?.body ?? "").length}`] = {
            status: response.status,
            headers: [...response.headers].filter(([header]) => header !== "date").sort(),
            body: (await response.text()).replaceAll(origin, "<origin>").replace(/\b\d{13}\b/g, "<time>"),
          };
        }
        return all;
      };
      const actual = await collectResponses(server.origin);
      const expected = await collectResponses(reference.origin);
      expect(actual).toEqual(expected);
    });

    // TODO: the text of a function that a page holds is indented with tabs in one and with two spaces in the other.
    (name === "tanstack" ? test.todo : test.skip)(
      "renders pages like Bun without --aot",
      async () => {
        using server = await startCompiled();
        using reference = await startServer([bunExe(), entry], folder, bunEnv);
        const statuses: Record<string, number> = {};
        for (const path of [
          "/",
          "/items",
          "/items/7",
          "/items/700",
          "/contacts",
          "/deferred",
          "/redirects",
          "/broken",
          "/search",
          "/search?page=2&word=Item",
          "/search?page=x",
        ]) {
          const page: Route = { name: path, method: "GET", path, type: "text/html", expectedBody: "" };
          // Pages embed the time their data was loaded, in milliseconds.
          const fetchPage = async (origin: string) => {
            const response = await sendRequest(origin, page);
            return { ...response, body: response.body.replace(/\b\d{13}\b/g, "<time>") };
          };
          const expected = await fetchPage(reference.origin);
          statuses[path] = expected.status;
          for (let n = 0; n < 100; n++) expect(await fetchPage(server.origin)).toEqual(expected);
        }
        // The router redirects non-canonical search params to their canonical form.
        expect(statuses).toEqual({
          "/": 200,
          "/items": 200,
          "/items/7": 200,
          "/items/700": 404,
          "/contacts": 200,
          "/deferred": 200,
          "/redirects": 307,
          "/broken": 500,
          "/search": 307,
          "/search?page=2&word=Item": 200,
          "/search?page=x": 307,
        });
      },
      60_000,
    );
  });

  describe.each(["go", "rust"].filter(name => requestedServers?.split(",").includes(name)))("%s", name => {
    test("serves the shared routes", async () => {
      const source = join(app, name);
      cpSync(join(import.meta.dir, name), source, { recursive: true });
      const executable = join(app, name === "go" ? "go-native" : "release/servers");
      const build = name === "go" ? ["go", "build", "-o", executable, "."] : ["cargo", "build", "--release"];
      const { stderr, exitCode } = await spawned(build, source, { ...bunEnv, CARGO_TARGET_DIR: app });
      expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
      using server = await startServer([executable], app, bunEnv);
      for (const route of routes.filter(route => route.name !== "hand" && route.name !== "typed")) {
        expect({ route: route.name, ...(await sendRequest(server.origin, route)) }).toEqual({
          route: route.name,
          status: 200,
          type: route.type,
          body: route.expectedBody,
        });
        if (route.method !== "POST") continue;
        for (const [description, request] of Object.entries(invalidOrders)) {
          // encoding/json and serde treat a null optional field like a missing one.
          expect({ description, status: (await sendRequest(server.origin, route, request)).status }).toEqual({
            description,
            status: description === "a coupon that is null" ? 200 : 400,
          });
        }
      }
    }, 300_000);
  });
});
