// Opt-in test, like ./servers.test.ts. The order of ./app/shared.ts is validated against a type in place of a zod schema (./app/validated.ts), on Bun.serve, Hono and Express:
// `validate<Order>(await request.json())` and `JSON.parse<Order>(await request.text())`. The type carries every rule of the schema, so the two must accept and refuse the same orders.
// Each server is held against the one with zod (./app/<name>.ts), compiled the same way, over the orders of ./answers.ts.
// ./measure/measure.py has them as columns beside zod; see the text at its top.
//
//   AOT_SERVERS=1 bun test test/aot/servers/validated                   all three
//   AOT_SERVERS=hono-validated bun test test/aot/servers/validated      only this one
//
// See ./servers.test.ts for AOT_SERVERS and AOT_SERVERS_MODULES.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, unsupported } from "../run-programs";
import {
  acceptedOrders,
  expectedReceipt,
  invalidOrderBody,
  invalidOrders,
  refusedOrders,
  refusedRoutes,
  routes,
  validatedRoutes,
  type Route,
} from "./answers";
import { filterRequested, installPackages, requestedServers, startServer } from "./run-servers";

const servers = filterRequested(["bun-validated", "hono-validated", "express-validated"]);
const zodRoute = routes.find(route => route.name === "post")!;

async function sendOrder(origin: string, route: Route, body = route.request) {
  const response = await fetch(origin + route.path, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
  return { status: response.status, body: await response.text() };
}

if (!requestedServers)
  console.error(
    "SKIPPED: test/aot/servers/validated.test.ts: it installs packages from npm. Set AOT_SERVERS=1 to run it",
  );

describe.skipIf(!requestedServers || !!unsupported)("compile/aot/servers/validated", () => {
  const app = String(tempDir("aot-servers-validated", {}));
  afterAll(() => rmSync(app, { recursive: true, force: true }));

  beforeAll(async () => {
    cpSync(join(import.meta.dir, "app"), app, { recursive: true });
    await installPackages(app);
  }, 300_000);

  describe.each(servers)("%s", name => {
    const compiled = (program: string) => join(app, `${program}-compiled${isWindows ? ".exe" : ""}`);
    const start = (program: string, env: Record<string, string> = {}) =>
      startServer([compiled(program)], app, { ...bunEnv, ...env });
    const withZod = name.replace(/-validated$/, "");

    beforeAll(async () => {
      for (const program of [name, withZod])
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              "--define",
              'process.env.NODE_ENV="production"',
              "--target=bun",
              `./${program}.ts`,
              "--outfile",
              compiled(program),
            ],
            app,
            bunEnv,
          ),
        );
    }, 240_000);

    test("accepts the orders that zod accepts, with the same receipt", async () => {
      using server = await start(name, { BUN_JSC_crashIfInterpreterIsUsed: "1" });
      using reference = await start(withZod);
      for (const [description, order] of Object.entries(acceptedOrders)) {
        const expected = { description, status: 200, body: expectedReceipt(order) };
        expect({ description, ...(await sendOrder(reference.origin, zodRoute, order)) }).toEqual(expected);
        for (const route of validatedRoutes)
          expect({ route: route.name, description, ...(await sendOrder(server.origin, route, order)) }).toEqual({
            route: route.name,
            ...expected,
          });
      }
    });

    test("refuses the orders that zod refuses", async () => {
      using server = await start(name, { BUN_JSC_crashIfInterpreterIsUsed: "1" });
      using reference = await start(withZod);
      const statuses: Record<string, number> = {};
      const expected: Record<string, number> = {};
      for (const [description, order] of Object.entries({ ...invalidOrders, ...refusedOrders })) {
        statuses[`zod: ${description}`] = (await sendOrder(reference.origin, zodRoute, order)).status;
        expected[`zod: ${description}`] = 400;
        for (const route of validatedRoutes) {
          statuses[`${route.name}: ${description}`] = (await sendOrder(server.origin, route, order)).status;
          expected[`${route.name}: ${description}`] = 400;
        }
      }
      expect(statuses).toEqual(expected);
      for (const route of refusedRoutes.filter(route => validatedRoutes.some(other => route.path === other.path)))
        expect({ route: route.name, ...(await sendOrder(server.origin, route)) }).toEqual({
          route: route.name,
          status: 400,
          body: invalidOrderBody,
        });
    });

    test.each([
      ["answers the same after a few thousand requests", {}],
      [
        "answers the same in zombie mode",
        { BUN_JSC_useZombieMode: "1", BUN_JSC_sweepSynchronously: "1", BUN_JSC_slowPathAllocsBetweenGCs: "50" },
      ],
    ])(
      "%s",
      async (_, env) => {
        using server = await start(name, { BUN_JSC_crashIfInterpreterIsUsed: "1", ...env });
        const refused = refusedRoutes.filter(route => validatedRoutes.some(other => route.path === other.path));
        for (const route of [...validatedRoutes, ...refused]) {
          const expected = { status: route.status ?? 200, body: route.expectedBody };
          let mismatch: unknown;
          await Promise.all(
            Array.from({ length: 16 }, async () => {
              for (let n = 0; n < 200 && !mismatch; n++) {
                const response = await sendOrder(server.origin, route);
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
