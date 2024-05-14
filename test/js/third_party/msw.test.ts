import { bunExe } from "bun:harness";
import { bunEnv, runBunInstall, tmpdirSync } from "harness";
import { expect, it } from "bun:test";
import * as path from "node:path";

it("works", async () => {
  const package_dir = tmpdirSync("bun-test-");

  await Bun.write(path.join(package_dir, "package.json"), `{ "dependencies": { "axios": "1.6.8", "msw": "2.3.0" } }`);
  await runBunInstall(bunEnv, package_dir);

  const fixture_path = path.join(package_dir, "index.ts");
  const fixture_data = `
    import axios from 'axios';
    import { http, passthrough, HttpResponse } from 'msw'
    import { setupServer } from 'msw/node'

    const server = setupServer(...[
      http.get('http://localhost/', () => {
        // return passthrough()
        return HttpResponse.json({ results: [{}, {}] })
      }),
    ])
    server.listen({
      onUnhandledRequest: 'warn',
    });

    axios.get('http://localhost/?page=2')
      .then(function (response) {
        // handle success
        console.log(response.data.results.length);
      })
      .catch(function (error) {
        // handle error
        console.log(error?.message);
      });
  `;
  await Bun.write(fixture_path, fixture_data);

  let { stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "run", fixture_path],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  let err = await new Response(stderr).text();
  expect(err).toBeEmpty();
  let out = await new Response(stdout).text();
  expect(out).toEqual("2\n");
  expect(await exited).toBe(0);
});
