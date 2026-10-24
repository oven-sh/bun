// Opt-in test, like ./servers.test.ts. A small API with what a real service has around its handlers: three middlewares (a request id, two security headers set after the handler,
// a bearer token), context variables, route parameters, a query string, JSON in and out, a cast as validation, an error handler and a 404 handler.
// It is written eight times on top of ./app/api-store.ts: by hand on Bun.serve (./app/api-bun.ts) and on node:http (api-node.ts), on the thin typed framework (api-thin.ts), and on Hono, Elysia, Express, Fastify and Koa.
// ./measure/measure.py --servers api-bun,api-thin,api-hono measures what each framework adds to the first.
//
//   AOT_SERVERS=1 bun test test/aot/servers/api              all three
//   AOT_SERVERS=api-thin bun test test/aot/servers/api       only this one
//
// See ./servers.test.ts for AOT_SERVERS and AOT_SERVERS_MODULES.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, unsupported } from "../run-programs";
import { apiRoutes, type Route } from "./answers";
import {
  filterRequested,
  installPackages,
  moreEnvironment,
  moreFlags,
  removeFolders,
  requestedServers,
  startServer,
} from "./run-servers";

const servers = filterRequested([
  "api-bun",
  "api-thin",
  "api-hono",
  "api-elysia",
  "api-node",
  "api-express",
  "api-fastify",
  "api-koa",
]);

async function sendRequest(origin: string, route: Route, body = route.request) {
  const response = await fetch(origin + route.path, {
    method: route.method,
    body,
    headers: { ...route.headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  });
  return {
    status: response.status,
    type: response.headers.get("Content-Type")?.split(";")[0]!.trim().toLowerCase(),
    added: ["x-request-id", "x-content-type-options", "cache-control"].map(name => response.headers.get(name)),
    body: await response.text(),
  };
}

const expectedOf = (route: Route) => ({
  status: route.status ?? 200,
  type: route.type === "-" ? expect.any(String) : route.type,
  added: ["r-1", "nosniff", "no-store"],
  body: route.expectedBody,
});

if (!requestedServers)
  console.error("SKIPPED: test/aot/servers/api.test.ts: it installs packages from npm. Set AOT_SERVERS=1 to run it");

describe.skipIf(!requestedServers || !!unsupported)("compile/aot/servers/api", () => {
  const app = String(tempDir("aot-servers-api", {}));
  afterAll(() => removeFolders(app));

  beforeAll(async () => {
    cpSync(join(import.meta.dir, "app"), app, { recursive: true });
    await installPackages(app);
  }, 300_000);

  describe.each(servers)("%s", name => {
    const executable = join(app, `${name}-compiled${isWindows ? ".exe" : ""}`);
    const startCompiled = (env: Record<string, string> = {}) =>
      startServer([executable], app, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", ...moreEnvironment, ...env });

    beforeAll(async () => {
      built(
        await spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            ...moreFlags,
            "--define",
            'process.env.NODE_ENV="production"',
            "--target=bun",
            `./${name}.ts`,
            "--outfile",
            executable,
          ],
          app,
          bunEnv,
        ),
      );
    }, 120_000);

    test("serves every route", async () => {
      using server = await startCompiled();
      for (const route of apiRoutes)
        expect({ route: route.name, ...(await sendRequest(server.origin, route)) }).toEqual({
          route: route.name,
          ...expectedOf(route),
        });
    });

    test.each([
      ["serves every route after a few thousand requests", {}],
      [
        "serves every route in zombie mode",
        { BUN_JSC_useZombieMode: "1", BUN_JSC_sweepSynchronously: "1", BUN_JSC_slowPathAllocsBetweenGCs: "50" },
      ],
    ])(
      "%s",
      async (_, env) => {
        using server = await startCompiled(env);
        for (const route of apiRoutes) {
          let mismatch: unknown;
          await Promise.all(
            Array.from({ length: 16 }, async () => {
              for (let n = 0; n < 200 && !mismatch; n++) {
                const response = await sendRequest(server.origin, route);
                if (response.status !== (route.status ?? 200) || response.body !== route.expectedBody)
                  mismatch = response;
              }
            }),
          );
          expect({ route: route.name, mismatch }).toEqual({ route: route.name, mismatch: undefined });
        }
      },
      240_000,
    );

    test("answers other requests like Bun without --aot", async () => {
      using server = await startCompiled();
      using reference = await startServer([bunExe(), `./${name}.ts`], app, bunEnv);
      const create = apiRoutes.find(route => route.name === "create")!;
      const others: Route[] = [
        { ...create, name: "text that is not JSON", request: '{"title":' },
        {
          ...create,
          name: "a priority out of range",
          request: JSON.stringify({ title: "a", priority: 9, assigneeId: 5, tags: [] }),
        },
        {
          ...create,
          name: "an unknown assignee",
          request: JSON.stringify({ title: "a", priority: 1, assigneeId: 500, tags: [] }),
        },
        { ...create, name: "an unknown project", path: "/api/projects/77/tasks" },
        { ...create, name: "an unknown token", headers: { ...create.headers, authorization: "Bearer nobody" } },
        { ...create, name: "no request id", headers: { authorization: create.headers!.authorization! } },
        { ...apiRoutes[1]!, name: "an id that is not a number", path: "/api/projects/three/tasks/317" },
        { ...apiRoutes[1]!, name: "an unknown task", path: "/api/projects/3/tasks/999" },
        { ...apiRoutes[1]!, name: "an unknown path under /api", path: "/api/nothing" },
      ];
      for (const route of others)
        expect({ route: route.name, ...(await sendRequest(server.origin, route)) }).toEqual({
          route: route.name,
          ...(await sendRequest(reference.origin, route)),
        });
    }, 120_000);
  });
});
