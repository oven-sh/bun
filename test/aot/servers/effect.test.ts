// Opt-in test. ./effect is an HTTP API written with Effect (HttpApi, services in layers, Schema for every body, typed errors
// that become status codes, concurrent effects, a stream), and ./effect/plain.ts answers the same routes by hand on Bun.serve.
// Both are built with `bun build --compile --aot` and sent the requests of `effectRoutes` in ./answers.ts.
//
//   every route        the status, the Content-Type and the exact body: once, then a few thousand times over keep-alive
//                      connections, with the GC running continuously, and with a GC every few allocations that scribbles over
//                      dead cells
//   an unknown path    404
//   the counter        /orders/count reports the orders that were accepted and none that were refused
//
//   AOT_SERVERS=effect bun test test/aot/servers/effect     (about a minute, mostly `bun install`)
//   AOT_SERVERS_MODULES=<node_modules folder> ..            use packages that are already installed; nothing is downloaded
//
// See ./servers.test.ts for AOT_SERVERS. ./measure/measure.py measures the same servers: `--servers effect`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, unsupported } from "../run-programs";
import { effectRoutes, type Route } from "./answers";
import { filterRequested, installPackages, requestedServers, startServer } from "./run-servers";

const isRequested = !!requestedServers && filterRequested(["effect"]).length > 0;

async function sendRequest(origin: string, route: Route) {
  const response = await fetch(origin + route.path, {
    method: route.method,
    body: route.request,
    headers: route.request === undefined ? {} : { "Content-Type": "application/json" },
  });
  return {
    status: response.status,
    type: response.headers.get("Content-Type")?.split(";")[0]!.trim().toLowerCase(),
    body: await response.text(),
  };
}

const expectedResponse = (route: Route) => ({
  status: route.status ?? 200,
  type: route.type,
  body: route.expectedBody,
});

if (!isRequested)
  console.error(
    "SKIPPED: test/aot/servers/effect.test.ts: it installs packages from npm. Set AOT_SERVERS=effect to run it",
  );

describe.skipIf(!isRequested || !!unsupported)("compile/aot/servers/effect", () => {
  const folder = String(tempDir("aot-servers-effect", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  beforeAll(async () => {
    cpSync(join(import.meta.dir, "effect"), folder, { recursive: true });
    await installPackages(folder);
  }, 300_000);

  describe.each(["bun", "plain"])("%s.ts", name => {
    const executable = join(folder, `${name}-compiled${isWindows ? ".exe" : ""}`);
    const startCompiled = (env: Record<string, string> = {}) =>
      startServer([executable], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", ...env });

    beforeAll(async () => {
      const flags = ["--define", 'process.env.NODE_ENV="production"', "--target=bun"];
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", ...flags, `./${name}.ts`, "--outfile", executable],
          folder,
          bunEnv,
        ),
      );
    }, 120_000);

    test("serves every route", async () => {
      using server = await startCompiled();
      for (const route of effectRoutes) {
        expect({ route: route.name, ...(await sendRequest(server.origin, route)) }).toEqual({
          route: route.name,
          ...expectedResponse(route),
        });
      }
      expect((await fetch(server.origin + "/nothing")).status).toBe(404);
    });

    test("counts accepted orders only", async () => {
      using server = await startCompiled();
      const [accepted, refused] = ["post", "refused"].map(name => effectRoutes.find(route => route.name === name)!);
      for (let n = 0; n < 3; n++) {
        expect((await sendRequest(server.origin, accepted)).status).toBe(200);
        expect((await sendRequest(server.origin, refused)).status).toBe(400);
      }
      expect(await (await fetch(server.origin + "/orders/count")).json()).toEqual({ placed: 3 });
    });

    test.each([
      ["serves every route after a few thousand requests", {}],
      ["serves every route with the GC running continuously", { BUN_JSC_collectContinuously: "1" }],
      [
        "serves every route in zombie mode",
        { BUN_JSC_useZombieMode: "1", BUN_JSC_sweepSynchronously: "1", BUN_JSC_slowPathAllocsBetweenGCs: "50" },
      ],
    ])(
      "%s",
      async (_, env) => {
        using server = await startCompiled(env);
        for (const route of effectRoutes) {
          const expected = expectedResponse(route);
          let mismatch: unknown;
          await Promise.all(
            Array.from({ length: 16 }, async () => {
              for (let n = 0; n < 100 && !mismatch; n++) {
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
  });
});
