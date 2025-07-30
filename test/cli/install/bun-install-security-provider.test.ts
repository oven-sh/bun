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

function run(
  name: string,
  options: {
    scanner: Bun.Install.Security.Provider["onInstall"] | string;
    fails: boolean;
    expect?: (std: { out: string; err: string }) => void | Promise<void>;
  },
) {
  test(name, async () => {
    const urls: string[] = [];
    setHandler(dummyRegistry(urls));

    if (typeof options.scanner === "string") {
      await write("./scanner.ts", options.scanner);
    } else {
      const s = `export const provider = {
  version: "1", 
  onInstall: ${options.scanner.toString()},
};`;

      await write("./scanner.ts", s);
    }

    const bunfig = await read("./bunfig.toml").text();
    await write("./bunfig.toml", bunfig + "\n" + "[install.security]" + "\n" + 'provider = "./scanner.ts"');

    await write("package.json", {
      name: "my-app",
      version: "1.0.0",
      dependencies: {},
    });

    const { out, err } = await runBunInstall(bunEnv, package_dir, {
      packages: ["bar"],
      allowErrors: true,
      allowWarnings: false,
      savesLockfile: false,
      expectedExitCode: 1,
    });

    if (options.fails) {
      expect(out).toContain("Installation cancelled due to fatal security issues");
    }

    expect(urls).toEqual([root_url + "/bar", root_url + "/bar-0.0.2.tgz"]);

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
  scanner: async ({ packages }) => {
    console.log(JSON.stringify(packages));

    return [
      {
        package: packages[0].name,
        description: "Advisory 1 description",
        level: "fatal",
        url: "https://example.com/advisory-1",
      },
    ];
  },
  expect: ({ out }) => {
    expect(out).toContain('\"version\":\"0.0.2\"');
    expect(out).toContain('\"name\":\"bar\"');
    expect(out).toContain('\"requestedRange\":\"^0.0.2\"');
    expect(out).toContain(`\"registryUrl\":\"${root_url}/\"`);
  },
});
