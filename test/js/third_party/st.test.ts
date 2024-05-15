import { bunExe } from "bun:harness";
import { bunEnv, runBunInstall, tmpdirSync } from "harness";
import { expect, it } from "bun:test";
import * as path from "node:path";

it("works", async () => {
  const package_dir = tmpdirSync();

  await Bun.write(path.join(package_dir, "package.json"), `{ "dependencies": { "st": "3.0.0" } }`);
  await runBunInstall(bunEnv, package_dir);

  const fixture_path = path.join(package_dir, "index.ts");
  const fixture_data = `
    import { createServer } from "node:http";
    import st from "st";

    function listen(server): Promise<URL> {
      return new Promise((resolve, reject) => {
        server.listen({ port: 0 }, (err, hostname, port) => {
          if (err) {
            reject(err);
          } else {
            resolve(new URL("http://"+hostname+":"+port));
          }
        });
      });
    }
    await using server = createServer(st(process.cwd()));
    const url = await listen(server);
    const res = await fetch(new URL("/index.ts", url));
    console.log(await res.text());
  `;
  await Bun.write(fixture_path, fixture_data);

  let { stdout, stderr } = Bun.spawn({
    cmd: [bunExe(), "run", fixture_path],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  // err = await new Response(stderr).text();
  // expect(err).toBeEmpty();
  let out = await new Response(stdout).text();
  expect(out).toEqual(fixture_data + "\n");
  expect(await exited).toBe(0);
});
