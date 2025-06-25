import { $, readableStreamToText, spawn } from "bun";
import { bunEnv, bunExe, gunzipJsonRequest, tempDirWithFiles } from "harness";
import * as path from "node:path";

const output = path.join(import.meta.dirname, "audit-fixtures.json");

const packages = await Array.fromAsync(
  new Bun.Glob("./*/package.json").scan({
    cwd: import.meta.dirname,
  }),
);

const absolutes = packages.map(p => path.resolve(import.meta.dirname, p));

const result: Record<string, unknown> = {
  "{}": {},
};

for (const packageJsonPath of absolutes) {
  const directory = path.dirname(packageJsonPath);
  const tmp = tempDirWithFiles("bun-audit-fixture-generator", directory);

  const { promise: requestBodyPromise, resolve, reject } = Promise.withResolvers<string>();

  using server = Bun.serve({
    port: 12345,
    fetch: async req => {
      try {
        const body = await gunzipJsonRequest(req);
        resolve(JSON.stringify(body));
      } catch (e) {
        reject(e);
      }

      return Response.json({});
    },
  });

  await $`bun i`.cwd(tmp);

  await spawn({
    cmd: [bunExe(), "audit"],
    cwd: tmp,
    env: {
      ...bunEnv,
      NPM_CONFIG_REGISTRY: server.url.toString(),
    },
  }).exited;

  const body = await requestBodyPromise;

  const { stdout, exited } = spawn({
    cmd: [bunExe(), "audit", "--json"],
    cwd: tmp,
    stdout: "pipe",
    stderr: "ignore",
    env: bunEnv,
  });

  await exited;

  const text = await readableStreamToText(stdout);

  result[body] = JSON.parse(text);
}

await Bun.file(output).write(JSON.stringify(result, null, "\t"));
