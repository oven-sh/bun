import { $ } from "bun";
import { gunzipJsonRequest, tempDirWithFiles } from "harness";
import * as path from "node:path";

const output = path.join(import.meta.dirname, "audit-fixtures.json");

const packages = await Array.fromAsync(
  new Bun.Glob("./*/package.json").scan({
    cwd: import.meta.dirname,
  }),
);

const absolutes = packages.map(p => path.resolve(import.meta.dirname, p));

const result: Record<string, string> = {};

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

  console.log(server.url.toString());

  await $`npm i`.cwd(tmp).nothrow();

  const p = await $`npm audit`
    .env({
      ...(process.env as NodeJS.Dict<string>),
      NPM_CONFIG_REGISTRY: server.url.toString(),
    })
    .nothrow()
    .cwd(tmp);

  console.log(`exited with ${p.exitCode}`);
  console.log(p.stdout.toString());
  console.log(p.stderr.toString());

  const body = await requestBodyPromise;

  const expectedNpmOutput = await $`npm audit --json`.cwd(tmp).nothrow();

  result[body] = JSON.parse(expectedNpmOutput.stdout.toString());
}

await Bun.file(output).write(JSON.stringify(result, null, "\t"));
