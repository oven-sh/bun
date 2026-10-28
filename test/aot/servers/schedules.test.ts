// Opt-in test, like ./servers.test.ts. What ../flow-schedules.test.ts does for two programs without packages, for the servers under ./app and ./tanstack: each is built under the usual
// schedule of flow's rules and under three others. Under each it serves every route with the exact answers of ./answers.ts, and its code stays within `mostSpread` of the usual schedule's.
// TanStack Start is the server whose code moved by 17 percent with the order alone.
//
//   AOT_SERVERS=1 bun test test/aot/servers/schedules.test.ts           all (four builds a server)
//   AOT_SERVERS=tanstack,node ..                                        only these
//   AOT_SERVERS_MODULES=<node_modules folder> ..                        nothing is downloaded
//
// Each server prints one line that begins with SCHEDULES: the bytes of code and the functions under each schedule.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { buildUnderEachSchedule } from "../harness/flow-schedules";
import { spawned, unsupported } from "../run-programs";
import { routes } from "./answers";
import { filterRequested, installPackages, removeFolders, requestedServers, startServer } from "./run-servers";

const servers = filterRequested(["hono", "elysia", "node", "express", "fastify", "tanstack"]);

if (!requestedServers)
  console.error(
    "SKIPPED: test/aot/servers/schedules.test.ts: it installs packages from npm. Set AOT_SERVERS=1 to run it",
  );

describe.skipIf(!requestedServers || !!unsupported)("compile/aot/servers/schedules", () => {
  const app = String(tempDir("aot-schedules", {}));
  const tanstack = String(tempDir("aot-schedules-tanstack", {}));
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

  test.each(servers)(
    "%s serves every route, with about the same code, under every schedule",
    async name => {
      const folder = name === "tanstack" ? tanstack : app;
      const entry = name === "tanstack" ? "./serve.ts" : `./${name}.ts`;
      const built = await buildUnderEachSchedule(name, folder, entry, [
        "--define",
        'process.env.NODE_ENV="production"',
        "--target=bun",
      ]);
      for (const { schedule, executable } of built) {
        using server = await startServer([executable], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
        for (const route of routes) {
          const response = await fetch(server.origin + route.path, {
            redirect: "manual",
            method: route.method,
            body: route.request,
            headers: route.request === undefined ? {} : { "Content-Type": "application/json" },
          });
          const type = response.headers.get("Content-Type")?.split(";")[0]!.trim().toLowerCase();
          expect({ schedule, route: route.name, status: response.status, type, body: await response.text() }).toEqual({
            schedule,
            route: route.name,
            status: 200,
            type: route.type,
            body: route.expectedBody,
          });
        }
      }
    },
    600_000,
  );
});
