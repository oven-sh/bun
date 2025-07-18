import { bunEnv, runBunInstall } from "harness";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  read,
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
          console.log("Security scanner is checking packages:", packages.map(p => p.name).join(", "));
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

  const pkg = "pkg";

  const { out, err } = await runBunInstall(bunEnv, package_dir, {
    packages: [pkg],
    allowErrors: true,
    allowWarnings: false,
    savesLockfile: false,
    expectedExitCode: 1,
  });

  expect(urls).toEqual([]);

  expect(out).toContain(`Security scanner is checking packages: ${pkg}`);
  expect(err).toContain("Installation cancelled due to fatal security advisories");
});
