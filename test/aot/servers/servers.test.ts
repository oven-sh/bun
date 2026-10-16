// An opt-in test. Seven HTTP servers answer the same routes, each written the way a user of that framework would write it:
// Bun.serve, Hono, Elysia, node:http, Express and Fastify (./app/<name>.ts over ./app/shared.ts), and TanStack Start
// (./tanstack, built with vite first, over the same shared.ts). Each is built with `bun build --compile --aot`, started, and
// asked for every route. ./answers.ts has the bytes that are right.
//
//   every route                       status 200, the media type and every byte of the body, first once and then a few thousand
//                                     times over connections that are kept alive, so that whatever acts on heat has acted;
//                                     and again with the compiler of regular expressions turned off, with the collector
//                                     running all the time, and with a collection every few allocations that overwrites
//                                     what is dead
//   the two routes that validate      400 for each of the bad orders in ./answers.ts (one validates with zod, one by hand)
//   the route that only casts         the status that plain Bun answers for the same bad order
//   a path that no route matches      404
//   a new array, behind all that      still has JavaScriptCore's fast storage
//   requests that no route expects    the status, the headers and the body that the same executable built without --aot answers
//   the pages of TanStack Start       what plain Bun answers
// ./go (net/http) and ./rust (axum) answer six of the routes. ./measure compares with them, so they are held to the same bytes.
//
//   AOT_SERVERS=1 bun test test/aot/servers              all seven (about two minutes, most of it `bun install`)
//   AOT_SERVERS=express,fastify bun test test/aot/servers   only these
//   AOT_SERVERS=go,rust bun test test/aot/servers        the two that are not JavaScript; `cargo build` downloads its crates
//   AOT_SERVERS_MODULES=<a node_modules folder> ..       the packages are already installed there, and nothing is downloaded
//
// Without AOT_SERVERS everything is skipped: the packages named in ./app/package.json and ./tanstack/package.json are
// downloaded from npm.
// ./measure has the tools that measure the same servers under load; the head of ./measure/measure.py says how.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, unsupported } from "../run-programs";
import { badOrders, refusal, routes, type Route } from "./answers";
import { installed, selected, started, wanted } from "./run-servers";

const servers = selected(["bun", "hono", "elysia", "node", "express", "fastify", "tanstack"]);

// Elysia declares the body of a request as `unknown`. Under --aot the cast from `unknown` to the type of an order is checked, and
// an order that does not have that type throws a TypeError, which the route answers with 400. Plain Bun goes on with the order.
// The other servers cast what JSON.parse or Request.json() returns, which is `any`, and that cast is not checked.
const checkedCasts: Record<string, Record<string, number>> = {
  elysia: { "typed: a name that is a number": 400 },
};

// Fastify's route declares that each member of the query is a string. A key that is repeated makes an array of it. Under --aot
// the array is checked where it is passed on as a string, and the TypeError becomes Fastify's answer for an error in a handler.
const checkedValues: Record<string, Record<string, number>> = {
  fastify: { "GET /users/42/posts/first?page=2&page=3&sort[]=top {} 0": 500 },
};

const json = { "Content-Type": "application/json" };
const order = routes.find(route => route.name === "post")!.request!;
const oddRequests: [method: string, path: string, init?: { headers?: Record<string, string>; body?: string }][] = [
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
  ["POST", "/shops/west/orders", { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "coupon=TENOFF" }],
  ["POST", `/shops/${"w".repeat(32)}/orders`, { headers: json, body: order }],
  ["POST", `/shops/${"w".repeat(33)}/orders`, { headers: json, body: order }],
  ["POST", "/shops/w%C3%A9st/orders", { headers: json, body: order }],
  ["POST", "/shops/west/orders", { headers: json, body: JSON.stringify({ ...JSON.parse(order), items: Array(101).fill(JSON.parse(order).items[0]) }) }],
  ["POST", "/shops/west/orders", { headers: json, body: JSON.stringify({ ...JSON.parse(order), coupon: "x".repeat(200_000) }) }],
  ["POST", "/shops/west/orders", { headers: json, body: order.replace('"id":4711', '"id":4711,"id":4712') }],
  ["POST", "/shops/west/orders", { headers: json, body: order.replace('"id":4711', '"__proto__":{"id":1},"id":4711') }],
  ["POST", "/shops/west/checked-orders", { headers: json, body: order.replace('"id":4711', '"id":1e400') }],
  ["POST", "/shops/west/checked-orders", { headers: json, body: order.replace('"id":4711', '"id":9007199254740993') }],
  ["POST", "/shops/west/typed-orders", { headers: json, body: order.replace('"coupon":"TENOFF"', '"coupon":"tenoff"') }],
];

async function asked(origin: string, route: Route, request = route.request) {
  const response = await fetch(origin + route.path, {
    redirect: "manual",
    method: route.method,
    body: request,
    headers: request === undefined ? {} : { "Content-Type": "application/json" },
  });
  return { status: response.status, type: response.headers.get("Content-Type")?.split(";")[0]!.trim().toLowerCase(), body: await response.text() };
}

if (!wanted) console.error("SKIPPED: test/aot/servers/servers.test.ts: it installs packages from npm. AOT_SERVERS=1 runs it");

describe.skipIf(!wanted || !!unsupported)("compile/aot/servers", () => {
  const app = String(tempDir("aot-servers", {}));
  const tanstack = String(tempDir("aot-servers-tanstack", {}));
  // Every executable is the size of Bun.
  afterAll(() => [app, tanstack].forEach(folder => rmSync(folder, { recursive: true, force: true })));

  beforeAll(async () => {
    if (servers.some(name => name !== "tanstack")) {
      cpSync(join(import.meta.dir, "app"), app, { recursive: true });
      await installed(app);
    }
    if (servers.includes("tanstack")) {
      cpSync(join(import.meta.dir, "tanstack"), tanstack, { recursive: true });
      cpSync(join(import.meta.dir, "app", "shared.ts"), join(tanstack, "src", "utils", "shared.ts"));
      await installed(tanstack);
      const vite = await spawned([bunExe(), "node_modules/vite/bin/vite.js", "build"], tanstack, bunEnv);
      expect({ output: vite.stdout + vite.stderr, exitCode: vite.exitCode }).toEqual({ output: expect.any(String), exitCode: 0 });
    }
  }, 300_000);

  describe.each(servers)("%s", name => {
    const folder = name === "tanstack" ? tanstack : app;
    const entry = name === "tanstack" ? "./serve.ts" : `./${name}.ts`;
    // The bundler replaces process.env.NODE_ENV, and without this with "development": React would be its development build, and
    // Express would answer an error with its stack.
    const flags = ["--define", 'process.env.NODE_ENV="production"'];
    const executable = join(folder, `${name}-compiled${isWindows ? ".exe" : ""}`);
    const compiled = (env: Record<string, string> = {}) => started([executable], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", ...env });

    beforeAll(async () => {
      built(await spawned([bunExe(), "build", "--compile", "--aot", ...flags, "--target=bun", entry, "--outfile", executable], folder, bunEnv));
    }, 120_000);

    test("answers every route", async () => {
      using server = await compiled();
      for (const route of routes) {
        expect({ route: route.name, ...(await asked(server.origin, route)) }).toEqual({ route: route.name, status: 200, type: route.type, body: route.answer });
      }
      expect((await fetch(server.origin + "/nothing")).status).toBe(404);
    });

    // Express and Hono match paths with regular expressions that they make at run time. Such a pattern starts in the interpreter
    // of regular expressions and is compiled once it is hot, so each of the two must give the same answers.
    test.each([
      ["answers the same after a few thousand requests", {}],
      ["answers the same with regular expressions interpreted", { BUN_JSC_useRegExpJIT: "0" }],
      ["answers the same while the collector runs all the time", { BUN_JSC_collectContinuously: "1" }],
      ["answers the same with dead objects overwritten at once", { BUN_JSC_useZombieMode: "1", BUN_JSC_sweepSynchronously: "1", BUN_JSC_slowPathAllocsBetweenGCs: "50" }],
    ])("%s", async (_, env) => {
      using server = await compiled(env);
      for (const route of routes) {
        const right = { status: 200, type: route.type, body: route.answer };
        let wrong: unknown;
        await Promise.all(
          Array.from({ length: 16 }, async () => {
            for (let n = 0; n < 200 && !wrong; n++) {
              const answer = await asked(server.origin, route);
              if (!Bun.deepEquals(answer, right)) wrong = answer;
            }
          }),
        );
        expect({ route: route.name, wrong }).toEqual({ route: route.name, wrong: undefined });
      }
    }, 240_000);

    // When an object that may have indexed accessors gets into the prototype chain of arrays or of Object.prototype's heirs,
    // JavaScriptCore moves every array of the realm to its slowest storage for good. Old-style inheritance between functions,
    // as util.inherits and transpiled classes do it, must not look like that.
    test("keeps the fast storage of its arrays", async () => {
      const kind = join(folder, `${name}-array-kind.txt`);
      writeFileSync(
        join(folder, `${name}-watched.ts`),
        `${readFileSync(join(folder, entry), "utf8")}
import { jscDescribe } from "bun:jsc";
import { writeFileSync } from "node:fs";
setInterval(() => writeFileSync(${JSON.stringify(kind)}, /ArrayWith[A-Za-z]+/.exec(jscDescribe([1, {}]))![0]), 20);
`,
      );
      const watched = join(folder, `${name}-watched${isWindows ? ".exe" : ""}`);
      built(await spawned([bunExe(), "build", "--compile", "--aot", ...flags, "--target=bun", `./${name}-watched.ts`, "--outfile", watched], folder, bunEnv));
      using server = await started([watched], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      for (const route of routes) for (let n = 0; n < 20; n++) expect((await asked(server.origin, route)).status).toBe(200);
      rmSync(kind, { force: true });
      while (!existsSync(kind) || !readFileSync(kind, "utf8")) await Bun.sleep(5);
      expect(readFileSync(kind, "utf8")).toBe("ArrayWithContiguous");
    }, 120_000);

    test("refuses bad orders", async () => {
      using server = await compiled();
      using plain = await started([bunExe(), entry], folder, bunEnv);
      const answered: Record<string, number> = {};
      const expected: Record<string, number> = {};
      for (const route of routes.filter(route => route.method === "POST")) {
        for (const [what, request] of Object.entries(badOrders)) {
          const { status, body } = await asked(server.origin, route, request);
          answered[`${route.name}: ${what}`] = status;
          expected[`${route.name}: ${what}`] = route.name === "typed" ? (await asked(plain.origin, route, request)).status : 400;
          if (what === "a quantity of zero") expect(body).toBe(refusal);
        }
        expect({ route: route.name, ...(await asked(server.origin, route)) }).toEqual({ route: route.name, status: 200, type: route.type, body: route.answer });
      }
      expect(answered).toEqual({ ...expected, ...checkedCasts[name] });
    });

    test("answers odd requests as without --aot", async () => {
      const bundled = join(folder, `${name}-bundled${isWindows ? ".exe" : ""}`);
      built(await spawned([bunExe(), "build", "--compile", ...flags, "--target=bun", entry, "--outfile", bundled], folder, bunEnv));
      using server = await compiled();
      using plain = await started([bundled], folder, bunEnv);
      const answers = async (origin: string) => {
        const all: Record<string, { status: number; headers: string[][]; body: string }> = {};
        for (const [method, path, init] of oddRequests) {
          const response = await fetch(origin + path, { method, redirect: "manual", ...init });
          all[`${method} ${path} ${JSON.stringify(init?.headers ?? {})} ${String(init?.body ?? "").length}`] = {
            status: response.status,
            headers: [...response.headers].filter(([header]) => header !== "date").sort(),
            body: (await response.text()).replaceAll(origin, "<origin>").replace(/\b\d{13}\b/g, "<time>"),
          };
        }
        return all;
      };
      const answered = await answers(server.origin);
      const expected = await answers(plain.origin);
      for (const [request, status] of Object.entries(checkedValues[name] ?? {})) {
        expect({ request, status: answered[request].status }).toEqual({ request, status });
        delete answered[request];
        delete expected[request];
      }
      expect(answered).toEqual(expected);
    });

    test.skipIf(name !== "tanstack")("renders the pages as plain Bun does", async () => {
      using server = await compiled();
      using plain = await started([bunExe(), entry], folder, bunEnv);
      const statuses: Record<string, number> = {};
      for (const path of ["/", "/items", "/items/7", "/items/700", "/contacts", "/deferred", "/redirects", "/broken", "/search", "/search?page=2&word=Item", "/search?page=x"]) {
        const page: Route = { name: path, method: "GET", path, type: "text/html", answer: "" };
        // A page carries the time at which its data was loaded, in milliseconds.
        const rendered = async (origin: string) => {
          const answer = await asked(origin, page);
          return { ...answer, body: answer.body.replace(/\b\d{13}\b/g, "<time>") };
        };
        const expected = await rendered(plain.origin);
        statuses[path] = expected.status;
        for (let n = 0; n < 100; n++) expect(await rendered(server.origin)).toEqual(expected);
      }
      // The router sends a search that is not in its canonical form to the one that is.
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
    }, 60_000);
  });

  describe.each(["go", "rust"].filter(name => wanted?.split(",").includes(name)))("%s", name => {
    test("answers as the others do", async () => {
      const source = join(app, name);
      cpSync(join(import.meta.dir, name), source, { recursive: true });
      const executable = join(app, name === "go" ? "go-native" : "release/servers");
      const build = name === "go" ? ["go", "build", "-o", executable, "."] : ["cargo", "build", "--release"];
      const { stderr, exitCode } = await spawned(build, source, { ...bunEnv, CARGO_TARGET_DIR: app });
      expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
      using server = await started([executable], app, bunEnv);
      for (const route of routes.filter(route => route.name !== "hand" && route.name !== "typed")) {
        expect({ route: route.name, ...(await asked(server.origin, route)) }).toEqual({ route: route.name, status: 200, type: route.type, body: route.answer });
        if (route.method !== "POST") continue;
        for (const [what, request] of Object.entries(badOrders)) {
          // To encoding/json and to serde, a member that is null is an optional member that is absent.
          expect({ what, status: (await asked(server.origin, route, request)).status }).toEqual({ what, status: what === "a coupon that is null" ? 200 : 400 });
        }
      }
    }, 300_000);
  });
});
