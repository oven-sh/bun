import { bunExe } from "bun:harness";
import { bunEnv, tmpdirSync } from "harness";
import { expect, it } from "bun:test";
import * as path from "node:path";

it("works", async () => {
  const package_dir = tmpdirSync("bun-test-");

  let { stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "add", "st@3.0.0"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  let err = await new Response(stderr).text();
  expect(err).not.toContain("panic:");
  expect(err).not.toContain("error:");
  expect(err).not.toContain("warn:");
  let out = await new Response(stdout).text();
  expect(await exited).toBe(0);

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

  ({ stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "run", fixture_path],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  }));
  // err = await new Response(stderr).text();
  // expect(err).toBeEmpty();
  out = await new Response(stdout).text();
  expect(out).toEqual(fixture_data + "\n");
  expect(await exited).toBe(0);
});
