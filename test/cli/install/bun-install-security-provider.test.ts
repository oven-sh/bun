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

function run(
  name: string,
  options: {
    scanner: Bun.Install.Security.Provider["onInstall"];
    fails: boolean;
    expect?: (std: { out: string; err: string }) => void | Promise<void>;
  },
) {
  test(name, async () => {
    const urls: string[] = [];
    setHandler(dummyRegistry(urls, { "0.0.5": { as: "0.0.5" } }));

    await write(
      "./scanner.ts",
      `
      export default {
        version: "1",
        onInstall: ${options.scanner.toString()},
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

    if (options.fails) {
      expect(err).toContain("Installation cancelled due to fatal security advisories");
    }

    await options.expect?.({ out, err });
  });
}

run("basic", {
  fails: true,
  scanner: async ({ packages }) => [
    {
      package: packages[0].name,
      description: "Advisory 1 description",
      level: "fatal",
      url: "https://example.com/advisory-1",
    },
  ],
});

run("expect output to contain the advisory", {
  fails: true,
  scanner: async ({ packages }) => [
    {
      package: packages[0].name,
      description: "Advisory 1 description",
      level: "fatal",
      url: "https://example.com/advisory-1",
    },
  ],
  expect: ({ out }) => {
    expect(out).toContain("Advisory 1 description");
  },
});

run("stdout contains all input package metadata", {
  fails: true,
  scanner: async ({ packages }) => [
    {
      package: packages[0].name,
      description: "Advisory 1 description",
      level: "fatal",
      url: "https://example.com/advisory-1",
    },
  ],
  expect: ({ out }) => {
    expect(out).toContain('"version": "1.0.0"');
    expect(out).toContain('"name": "pkg"');
    expect(out).toContain('"requestedRange": "latest"');
    expect(out).toContain('"registryUrl": "https://registry.npmjs.org"');
  },
});
