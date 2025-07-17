import { bunEnv, runBunInstall } from "harness";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  read,
  root_url,
  setHandler,
  write,
} from "./dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(dummyBeforeEach);
afterEach(dummyAfterEach);

test("basic", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.5": { as: "0.0.5" } }));

  await write(
    "./scanner.ts",
    `
      export default {
        version: "1",
        onInstall: async ({packages}) => {
          return [
            {
              name: packages[0].name,
              level: 'fatal',
            }
          ];
        },
      } satisfies Bun.Install.Security.Provider;
    `,
  );

  const bunfig = await read("./bunfig.toml").text();
  await write("./bunfig.toml", bunfig + "\n" + "[install.security]" + "\n" + 'provider = "./scanner.ts"');

  await write("package.json", {
    name: "my-app",
    version: "1.0.0",
    dependencies: {},
  });

  const { out } = await runBunInstall(bunEnv, package_dir, {
    packages: ["baz"],
    allowErrors: true,
  });

  expect(urls).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.5.tgz`]);

  expect(out).toContain("Installation cancelled due to fatal security advisories");
});
