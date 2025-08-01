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

function test(
  name: string,
  options: {
    testTimeout?: number;
    scanner: Bun.Security.Provider["scan"] | string;
    fails?: boolean;
    expect?: (std: { out: string; err: string }) => void | Promise<void>;
    expectedExitCode?: number;
    bunfigProvider?: string | false;
    packages?: string[];
    scannerFile?: string;
  },
) {
  it(
    name,
    async () => {
      const urls: string[] = [];
      setHandler(dummyRegistry(urls));

      const scannerPath = options.scannerFile || "./scanner.ts";
      if (typeof options.scanner === "string") {
        await write(scannerPath, options.scanner);
      } else {
        const s = `export const provider = {
  version: "1",
  scan: ${options.scanner.toString()},
};`;
        await write(scannerPath, s);
      }

      const bunfig = await read("./bunfig.toml").text();
      if (options.bunfigProvider !== false) {
        const providerPath = options.bunfigProvider ?? "./scanner.ts";
        await write("./bunfig.toml", `${bunfig}\n[install.security]\nprovider = "${providerPath}"`);
      }

      await write("package.json", {
        name: "my-app",
        version: "1.0.0",
        dependencies: {},
      });

      const expectedExitCode = options.expectedExitCode ?? (options.fails ? 1 : 0);
      const packages = options.packages ?? ["bar"];

      const { out, err } = await runBunInstall(bunEnv, package_dir, {
        packages,
        allowErrors: true,
        allowWarnings: false,
        savesLockfile: false,
        expectedExitCode,
      });

      if (options.fails) {
        expect(out).toContain("Installation cancelled due to fatal security issues");
      }

      await options.expect?.({ out, err });
    },
    {
      timeout: options.testTimeout ?? 5_000,
    },
  );
}

test("basic", {
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

test("expect output to contain the advisory", {
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

test("stdout contains all input package metadata", {
  fails: false,
  scanner: async ({ packages }) => {
    console.log(JSON.stringify(packages));
    return [];
  },
  expect: ({ out }) => {
    expect(out).toContain('\"version\":\"0.0.2\"');
    expect(out).toContain('\"name\":\"bar\"');
    expect(out).toContain('\"requestedRange\":\"^0.0.2\"');
    expect(out).toContain(`\"tarball\":\"${root_url}/bar-0.0.2.tgz\"`);
  },
});

describe("Security Provider Edge Cases", () => {
  test("provider module not found", {
    scanner: "dummy", // We need a scanner but will override the path
    bunfigProvider: "./non-existent-scanner.ts",
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Cannot find module");
    },
  });

  test("provider module throws during import", {
    scanner: `throw new Error("Module failed to load");`,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Module failed to load");
    },
  });

  test("provider missing version field", {
    scanner: `export const provider = {
      scan: async () => []
    };`,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security provider must be version 1");
    },
  });

  test("provider wrong version", {
    scanner: `export const provider = {
      version: "2",
      scan: async () => []
    };`,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security provider must be version 1");
    },
  });

  test("provider missing scan", {
    scanner: `export const provider = {
      version: "1"
    };`,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("provider.scan is not a function");
    },
  });

  test("provider scan not a function", {
    scanner: `export const provider = {
      version: "1",
      scan: "not a function"
    };`,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("provider.scan is not a function");
    },
  });
});

// Invalid return value tests
describe("Invalid Return Values", () => {
  test("provider returns non-array", {
    scanner: async () => "not an array" as any,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security provider must return an array of advisories");
    },
  });

  test("provider returns null", {
    scanner: async () => null as any,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security provider must return an array of advisories");
    },
  });

  test("provider returns undefined", {
    scanner: async () => undefined as any,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security provider must return an array of advisories");
    },
  });

  test("provider throws exception", {
    scanner: async () => {
      throw new Error("Scanner failed");
    },
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Scanner failed");
    },
  });

  test("provider returns non-object in array", {
    scanner: async () => ["not an object"] as any,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 0 must be an object");
    },
  });
});

// Invalid advisory format tests
describe("Invalid Advisory Formats", () => {
  test("advisory missing package field", {
    scanner: async () => [
      {
        description: "Missing package field",
        level: "fatal",
        url: "https://example.com",
      } as any,
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 0 missing required 'package' field");
    },
  });

  test("advisory package field not string", {
    scanner: async () => [
      {
        package: 123,
        description: "Package is number",
        level: "fatal",
        url: "https://example.com",
      } as any,
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 0 'package' field must be a string");
    },
  });

  test("advisory package field empty string", {
    scanner: async () => [
      {
        package: "",
        description: "Empty package name",
        level: "fatal",
        url: "https://example.com",
      },
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 0 'package' field cannot be empty");
    },
  });

  test("advisory missing description field", {
    scanner: async () => [
      {
        package: "bar",
        level: "fatal",
        url: "https://example.com",
      } as any,
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 0 missing required 'description' field");
    },
  });

  test("advisory description field not string", {
    scanner: async () => [
      {
        package: "bar",
        description: { text: "object description" },
        level: "fatal",
        url: "https://example.com",
      } as any,
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 0 'description' field must be a string");
    },
  });

  test("advisory missing url field", {
    scanner: async () => [
      {
        package: "bar",
        description: "Missing URL",
        level: "fatal",
      } as any,
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 0 missing required 'url' field");
    },
  });

  test("advisory missing level field", {
    scanner: async () => [
      {
        package: "bar",
        description: "Missing level",
        url: "https://example.com",
      } as any,
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 0 missing required 'level' field");
    },
  });

  test("advisory url field not string", {
    scanner: async () => [
      {
        package: "bar",
        description: "URL is boolean",
        level: "fatal",
        url: true,
      } as any,
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 0 'url' field must be a string");
    },
  });

  test("advisory invalid level", {
    scanner: async () => [
      {
        package: "bar",
        description: "Invalid level",
        level: "critical",
        url: "https://example.com",
      } as any,
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 0 'level' field must be 'fatal' or 'warn'");
    },
  });

  test("advisory level not string", {
    scanner: async () => [
      {
        package: "bar",
        description: "Level is number",
        level: 1,
        url: "https://example.com",
      } as any,
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 0 'level' field must be a string");
    },
  });

  test("second advisory invalid", {
    scanner: async () => [
      {
        package: "bar",
        description: "Valid advisory",
        level: "warn",
        url: "https://example.com/1",
      },
      {
        package: "baz",
        // missing description
        level: "fatal",
        url: "https://example.com/2",
      } as any,
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 1 missing required 'description' field");
    },
  });
});

describe("Process Behavior", () => {
  test("provider process exits early", {
    scanner: `
      console.log("Starting...");
      process.exit(42);
    `,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security provider exited with code 42 without sending data");
    },
  });

  // run("provider async timeout", {
  //   testTimeout: 30_000 + 5_000,
  //   scanner: async () => {
  //     await new Promise(resolve => setTimeout(resolve, 30_000));
  //     return [];
  //   },
  //   expectedExitCode: 1,
  //   expect: ({ err }) => {
  //     expect(err).toMatchInlineSnapshot(`"Security provider timed out after 30 seconds"`);
  //   },
  // });
});

describe("Large Data Handling", () => {
  test("provider returns many advisories", {
    scanner: async ({ packages }) => {
      const advisories: any[] = [];

      for (let i = 0; i < 1000; i++) {
        advisories.push({
          package: packages[0].name,
          description: `Advisory ${i} description with a very long text that might cause buffer issues`,
          level: i % 10 === 0 ? "fatal" : "warn",
          url: `https://example.com/advisory-${i}`,
        });
      }

      return advisories;
    },
    fails: true,
    expect: ({ out }) => {
      expect(out).toContain("Advisory 0 description");
      expect(out).toContain("Advisory 99 description");
      expect(out).toContain("Advisory 999 description");
    },
  });

  test("provider with very large response", {
    scanner: async ({ packages }) => {
      const longString = Buffer.alloc(10000, 65).toString(); // 10k of 'A's
      return [
        {
          package: packages[0].name,
          description: longString,
          level: "fatal",
          url: "https://example.com",
        },
      ];
    },
    fails: true,
    expect: ({ out }) => {
      expect(out).toContain("AAAA");
    },
  });
});

// describe("Warning Level Advisories", () => {
//   test("only warning level advisories", {
//     scanner: async ({ packages }) => [
//       {
//         package: packages[0].name,
//         description: "This is just a warning",
//         level: "warn",
//         url: "https://example.com/warning",
//       },
//     ],
//     expectedExitCode: 0, // Should continue with warnings
//     expect: ({ out }) => {
//       expect(out).toContain("WARN: bar");
//       expect(out).toContain("This is just a warning");
//       expect(out).toContain("Security warnings found. Continuing anyway...");
//       expect(out).not.toContain("Installation cancelled");
//     },
//   });

//   test("mixed fatal and warn advisories", {
//     scanner: async ({ packages }) => [
//       {
//         package: packages[0].name,
//         description: "Warning advisory",
//         level: "warn",
//         url: "https://example.com/warning",
//       },
//       {
//         package: packages[0].name,
//         description: "Fatal advisory",
//         level: "fatal",
//         url: "https://example.com/fatal",
//       },
//     ],
//     fails: true,
//     expect: ({ out }) => {
//       expect(out).toContain("WARN: bar");
//       expect(out).toContain("FATAL: bar");
//       expect(out).toContain("Installation cancelled due to fatal security issues");
//     },
//   });
// });

describe("Multiple Package Scanning", () => {
  test("multiple packages scanned", {
    packages: ["bar", "qux"],
    scanner: async ({ packages }) => {
      return packages.map((pkg, i) => ({
        package: pkg.name,
        description: `Security issue in ${pkg.name}`,
        level: "fatal",
        url: `https://example.com/${pkg.name}`,
      }));
    },
    fails: true,
    expect: ({ out }) => {
      expect(out).toContain("Security issue in bar");
      expect(out).toContain("Security issue in qux");
    },
  });
});

describe("Edge Cases", () => {
  test("empty advisories array", {
    scanner: async () => [],
    expectedExitCode: 0,
    expect: ({ out }) => {
      expect(out).not.toContain("Security advisories found");
    },
  });

  test("special characters in advisory", {
    scanner: async ({ packages }) => [
      {
        package: packages[0].name,
        description: "Advisory with \"quotes\" and 'single quotes' and \n newlines \t tabs",
        level: "fatal",
        url: "https://example.com/path?param=value&other=123#hash",
      },
    ],
    fails: true,
    expect: ({ out }) => {
      expect(out).toContain("quotes");
      expect(out).toContain("single quotes");
    },
  });

  test("unicode in advisory fields", {
    scanner: async ({ packages }) => [
      {
        package: packages[0].name,
        description: "Security issue with emoji 🔒 and unicode ñ é ü",
        level: "fatal",
        url: "https://example.com/unicode",
      },
    ],
    fails: true,
    expect: ({ out }) => {
      expect(out).toContain("🔒");
      expect(out).toContain("ñ é ü");
    },
  });

  test("advisory without level field", {
    scanner: async ({ packages }) => [
      {
        package: packages[0].name,
        description: "No level specified",
        url: "https://example.com",
      } as any,
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 0 missing required 'level' field");
    },
  });

  test("null values in level field", {
    scanner: async ({ packages }) => [
      {
        package: packages[0].name,
        description: "Advisory with null level",
        level: null as any,
        url: "https://example.com",
      },
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 0 'level' field must be a string");
    },
  });
});

// only npm supported currently
// test("receives transitive dependencies", {
//   packages: ["depends-on-monkey"], // This package depends on monkey
//   expectedExitCode: 0,
//   scanner: async ({ packages }) => {
//     console.log("Total packages received:", packages.length);
//     for (const pkg of packages) console.log("Scanning:", pkg.name);
//     return [];
//   },
//   expect: ({ out }) => {
//     expect(out).toContain("Total packages received:");
//     expect(out).toContain("Scanning: depends-on-monkey");
//     expect(out).toContain("Scanning: monkey");
//   },
// });

describe("Workspaces", () => {
  test("scanner receives all workspace packages", {
    scanner: async ({ packages }) => {
      console.log("Workspace packages:");
      for (const pkg of packages) {
        console.log(`- ${pkg.name}@${pkg.version} (${pkg.requestedRange || "direct"})`);
      }
      return [];
    },
    expectedExitCode: 0,
    expect: async ({ out }) => {
      await write("package.json", {
        name: "root-workspace",
        version: "1.0.0",
        workspaces: ["packages/*"],
      });

      await write("packages/app/package.json", {
        name: "@workspace/app",
        version: "1.0.0",
        dependencies: {
          "@workspace/lib": "workspace:*",
          "bar": "^0.0.2",
        },
      });

      await write("packages/lib/package.json", {
        name: "@workspace/lib",
        version: "1.0.0",
        dependencies: {
          "qux": "^0.0.2",
        },
      });

      // The test will run install and the scanner should see all packages
      expect(out).toContain("Workspace packages:");
      expect(out).toContain("bar@0.0.2");
      expect(out).toContain("qux@0.0.2");
    },
  });

  test("install workspace package using add command", {
    scanner: async ({ packages }) => {
      console.log("Adding workspace package:");
      for (const pkg of packages) {
        console.log(`- ${pkg.name}@${pkg.version} (${pkg.requestedRange || "direct"})`);
        // Check if this package is from a workspace
        if (!pkg.tarball || pkg.tarball === "") {
          console.log("  ^ This appears to be a workspace package");
        }
      }
      return [];
    },
    packages: ["@workspace/utils"], // Simulating: bun add @workspace/utils
    expectedExitCode: 0,
    expect: async ({ out }) => {
      // Set up workspace structure
      await write("../package.json", {
        name: "my-monorepo",
        workspaces: ["packages/*"],
      });

      await write("../packages/utils/package.json", {
        name: "@workspace/utils",
        version: "2.0.0",
        dependencies: {
          "qux": "^0.0.2",
        },
      });

      await write("../packages/app/package.json", {
        name: "@workspace/app",
        version: "1.0.0",
        dependencies: {
          "bar": "^0.0.2",
        },
      });

      // Test harness will create package.json in package_dir
      // But we need to indicate we're in a workspace
      await write("../../package.json", {
        name: "my-monorepo",
        workspaces: ["packages/*"],
      });

      expect(out).toContain("Adding workspace package:");
      expect(out).toContain("@workspace/utils");
    },
  });

  test("scanner can flag workspace package vulnerabilities", {
    scanner: async ({ packages }) => {
      const workspacePkg = packages.find(p => p.name === "@workspace/lib");
      if (workspacePkg) {
        return [
          {
            package: workspacePkg.name,
            description: "Security issue in workspace package",
            level: "fatal",
            url: "https://example.com/workspace-vuln",
          },
        ];
      }
      return [];
    },
    fails: true,
    expectedExitCode: 1,
    expect: async ({ out }) => {
      await write("package.json", {
        name: "root",
        workspaces: ["packages/*"],
      });

      await write("packages/lib/package.json", {
        name: "@workspace/lib",
        version: "1.0.0",
      });

      await write("packages/app/package.json", {
        name: "@workspace/app",
        dependencies: {
          "@workspace/lib": "workspace:*",
        },
      });

      expect(out).toContain("FATAL: @workspace/lib");
      expect(out).toContain("Security issue in workspace package");
    },
  });

  test("install workspace B from within workspace A", {
    scanner: async ({ packages }) => {
      console.log("Installing sibling workspace:");
      for (const pkg of packages) {
        console.log(`Package: ${pkg.name}@${pkg.version}`);
        console.log(`  - registryUrl: ${pkg.registryUrl || "none"}`);
        console.log(`  - requestedRange: ${pkg.requestedRange}`);

        // Workspace packages may have empty registryUrl or a special workspace: protocol
        if (pkg.name.includes("workspace-b")) {
          console.log(`  --> Found workspace B!`);
        }
      }
      return [];
    },
    packages: ["workspace-b"], // Simulating: cd workspace-a && bun add workspace-b
    expectedExitCode: 0,
    expect: async ({ out }) => {
      // Create a monorepo with two workspaces
      await write("../../package.json", {
        name: "monorepo",
        private: true,
        workspaces: ["*"],
      });

      // Create workspace-a (we're "inside" this one)
      await write("../workspace-a/package.json", {
        name: "workspace-a",
        version: "1.0.0",
      });

      // Create workspace-b (we're installing this)
      await write("../workspace-b/package.json", {
        name: "workspace-b",
        version: "2.0.0",
        dependencies: {
          "bar": "^0.0.2",
        },
      });

      // Test simulates: cd workspace-a && bun add workspace-b
      // The security scanner should see workspace-b being installed

      expect(out).toContain("Installing sibling workspace:");
      expect(out).toContain("workspace-b@2.0.0");
      expect(out).toContain("Found workspace B!");
    },
  });
});

describe("Local Packages", () => {
  test("scanner receives local file dependencies", {
    scanner: async ({ packages }) => {
      console.log("Packages from local sources:");
      for (const pkg of packages) {
        if (pkg.registryUrl?.startsWith("file:")) {
          console.log(`- Local: ${pkg.name} from ${pkg.registryUrl}`);
        }
      }
      return [];
    },
    expectedExitCode: 0,
    expect: async ({ out }) => {
      await write("local-pkg/package.json", {
        name: "local-package",
        version: "1.0.0",
        dependencies: {
          "bar": "^0.0.2",
        },
      });

      await write("package.json", {
        name: "test-app",
        dependencies: {
          "local-package": "file:./local-pkg",
        },
      });

      expect(out).toContain("Local: local-package");
    },
  });

  test("scanner flags vulnerabilities in local packages", {
    scanner: async ({ packages }) => {
      const localPkg = packages.find(p => p.name === "vulnerable-local");
      if (localPkg) {
        return [
          {
            package: localPkg.name,
            description: "Local package contains malicious code",
            level: "fatal",
            url: "https://example.com/local-malware",
          },
        ];
      }
      return [];
    },
    fails: true,
    expect: async ({ out }) => {
      await write("malicious/package.json", {
        name: "vulnerable-local",
        version: "1.0.0",
      });

      await write("package.json", {
        name: "app",
        dependencies: {
          "vulnerable-local": "file:./malicious",
        },
      });

      expect(out).toContain("FATAL: vulnerable-local");
      expect(out).toContain("Local package contains malicious code");
    },
  });

  test("scanner with relative path dependencies", {
    scanner: async ({ packages }) => {
      for (const pkg of packages) {
        if (pkg.name === "sibling-package") {
          console.log(`Found relative dependency: ${pkg.name}`);
        }
      }
      return [];
    },
    expectedExitCode: 0,
    expect: async ({ out }) => {
      await write("../sibling/package.json", {
        name: "sibling-package",
        version: "1.0.0",
      });

      await write("package.json", {
        name: "app",
        dependencies: {
          "sibling-package": "file:../sibling",
        },
      });

      expect(out).toContain("Found relative dependency: sibling-package");
    },
  });
});

describe("Scoped Packages", () => {
  test("scanner handles scoped packages correctly", {
    scanner: async ({ packages }) => {
      console.log("Scoped packages:");
      for (const pkg of packages) {
        if (pkg.name.startsWith("@")) {
          console.log(`- Scoped: ${pkg.name} (${pkg.version})`);
        }
      }
      return [];
    },
    packages: ["@barn/moo", "@scope/package"],
    expectedExitCode: 0,
    expect: ({ out }) => {
      expect(out).toContain("Scoped: @barn/moo");
      expect(out).toContain("Scoped: @scope/package");
    },
  });

  test("scanner with private scoped packages", {
    scanner: async ({ packages }) => {
      const privatePkgs = packages.filter(p => p.name.startsWith("@private/") || p.name.startsWith("@company/"));

      if (privatePkgs.length > 0) {
        console.log(`Found ${privatePkgs.length} private packages`);
        for (const pkg of privatePkgs) {
          console.log(`- ${pkg.name} from ${pkg.registryUrl}`);
        }
      }

      return [];
    },
    expectedExitCode: 0,
    expect: async ({ out }) => {
      await write(
        ".npmrc",
        `
@company:registry=https://npm.company.com
@private:registry=https://private-registry.com
`,
      );

      await write("package.json", {
        name: "test-private",
        dependencies: {
          "@company/internal-tool": "^1.0.0",
          "@private/secret-lib": "^2.0.0",
          "bar": "^0.0.2",
        },
      });

      expect(out).toContain("private packages");
    },
  });
});

describe("Package Resolution", () => {
  test("scanner receives aliased packages", {
    scanner: async ({ packages }) => {
      console.log("Package aliases:");
      for (const pkg of packages) {
        if (pkg.requestedRange?.startsWith("npm:")) {
          console.log(`- ${pkg.name}: aliased from ${pkg.requestedRange}`);
        }
      }
      return [];
    },
    expectedExitCode: 0,
    expect: async ({ out }) => {
      await write("package.json", {
        name: "test-aliases",
        dependencies: {
          "my-bar": "npm:bar@^0.0.2",
          "legacy-qux": "npm:qux@0.0.1",
        },
      });

      expect(out).toContain("Package aliases:");
      expect(out).toContain("aliased from npm:");
    },
  });

  test("scanner with version ranges", {
    scanner: async ({ packages }) => {
      console.log("Version ranges:");
      for (const pkg of packages) {
        console.log(`- ${pkg.name}: ${pkg.requestedRange} resolved to ${pkg.version}`);
      }
      return [];
    },
    packages: ["bar@~0.0.1", "qux@>=0.0.1 <1.0.0"],
    expectedExitCode: 0,
    expect: ({ out }) => {
      expect(out).toContain("bar: ~0.0.1 resolved to");
      expect(out).toContain("qux: >=0.0.1 <1.0.0 resolved to");
    },
  });

  test("scanner with latest tags", {
    scanner: async ({ packages }) => {
      for (const pkg of packages) {
        if (pkg.requestedRange === "latest" || pkg.requestedRange === "*") {
          console.log(`Latest tag: ${pkg.name}@${pkg.requestedRange} -> ${pkg.version}`);
        }
      }
      return [];
    },
    packages: ["bar@latest", "qux@*"],
    expectedExitCode: 0,
    expect: ({ out }) => {
      expect(out).toContain("Latest tag:");
    },
  });
});

describe("Private Registries", () => {
  test("scanner detects packages from private registries", {
    scanner: async ({ packages }) => {
      console.log("Registry URLs:");
      for (const pkg of packages) {
        if (pkg.registryUrl && !pkg.registryUrl.includes("registry.npmjs.org")) {
          console.log(`- ${pkg.name} from private: ${pkg.registryUrl}`);
        }
      }
      return [];
    },
    expectedExitCode: 0,
    expect: async ({ out }) => {
      await write(
        ".npmrc",
        `
@mycompany:registry=https://npm.mycompany.com
//npm.mycompany.com/:_authToken=secret-token
`,
      );

      await write("package.json", {
        name: "test-private-registry",
        dependencies: {
          "@mycompany/internal": "^1.0.0",
          "bar": "^0.0.2",
        },
      });

      expect(out).toContain("from private:");
    },
  });

  test("scanner with multiple registries", {
    scanner: async ({ packages }) => {
      const registries = new Set(packages.map(p => p.registryUrl).filter(Boolean));
      console.log(`Packages from ${registries.size} different registries`);
      for (const reg of registries) {
        console.log(`- ${reg}`);
      }
      return [];
    },
    expectedExitCode: 0,
    expect: async ({ out }) => {
      await write(
        ".npmrc",
        `
@corp:registry=https://registry.corp.com
@vendor:registry=https://vendor.npmjs.com
`,
      );

      await write("package.json", {
        name: "multi-registry",
        dependencies: {
          "@corp/lib": "^1.0.0",
          "@vendor/tool": "^2.0.0",
          "bar": "^0.0.2",
        },
      });

      expect(out).toContain("different registries");
    },
  });
});

describe("Complex Scenarios", () => {
  test("scanner with mixed dependency types", {
    scanner: async ({ packages }) => {
      const stats = {
        registry: 0,
        git: 0,
        local: 0,
        workspace: 0,
        tarball: 0,
        github: 0,
      };

      for (const pkg of packages) {
        const range = pkg.requestedRange || "";
        if (range.startsWith("file:")) stats.local++;
        else if (range.includes("git+") || range.includes("git@")) stats.git++;
        else if (range.includes(".tgz") || range.includes(".tar.gz")) stats.tarball++;
        else if (range.includes("github:") || range.includes("/")) stats.github++;
        else if (range.startsWith("workspace:")) stats.workspace++;
        else stats.registry++;
      }

      console.log("Dependency sources:", JSON.stringify(stats));
      return [];
    },
    expectedExitCode: 0,
    expect: async ({ out }) => {
      await write("package.json", {
        name: "complex-app",
        workspaces: ["packages/*"],
        dependencies: {
          "bar": "^0.0.2",
          "git-pkg": "git+https://github.com/example/repo.git",
          "local-pkg": "file:./local",
          "tarball-pkg": "https://example.com/pkg.tgz",
          "gh-pkg": "user/repo",
        },
      });

      await write("packages/workspace-pkg/package.json", {
        name: "@app/workspace-pkg",
        version: "1.0.0",
      });

      await write("local/package.json", {
        name: "local-pkg",
        version: "1.0.0",
      });

      expect(out).toContain("Dependency sources:");

      expect().fail("Todo");
    },
  });

  test("scanner handles monorepo with cross-dependencies", {
    scanner: async ({ packages }) => {
      const workspacePkgs = packages.filter(p => p.name.startsWith("@monorepo/"));
      console.log(`Found ${workspacePkgs.length} workspace packages`);

      const deps = new Map<string, string[]>();
      for (const pkg of workspacePkgs) {
        // In real scenario, would parse package.json to find deps
        console.log(`- ${pkg.name}`);
      }

      return [];
    },
    expectedExitCode: 0,
    expect: async ({ out }) => {
      await write("package.json", {
        name: "monorepo-root",
        workspaces: ["apps/*", "libs/*"],
      });

      await write("libs/core/package.json", {
        name: "@monorepo/core",
        version: "1.0.0",
      });

      await write("libs/utils/package.json", {
        name: "@monorepo/utils",
        version: "1.0.0",
        dependencies: {
          "@monorepo/core": "workspace:*",
        },
      });

      await write("apps/web/package.json", {
        name: "@monorepo/web",
        version: "1.0.0",
        dependencies: {
          "@monorepo/core": "workspace:*",
          "@monorepo/utils": "workspace:*",
          "bar": "^0.0.2",
        },
      });

      expect(out).toContain("workspace packages");
      expect(out).toContain("@monorepo/");
    },
  });

  test("scanner with conditional vulnerability detection", {
    scanner: async ({ packages }) => {
      const advisories: Bun.Security.Advisory[] = [];

      // Flag old versions
      const oldPackages = packages.filter(p => p.version && p.version.startsWith("0."));

      for (const pkg of oldPackages) {
        advisories.push({
          package: pkg.name,
          description: `Package ${pkg.name} is using pre-1.0 version which may be unstable`,
          level: "warn",
          url: "https://example.com/stability",
        });
      }

      // Flag git dependencies
      const gitDeps = packages.filter(p => p.requestedRange?.includes("git"));

      for (const pkg of gitDeps) {
        advisories.push({
          package: pkg.name,
          description: "Git dependencies bypass registry security checks",
          level: "warn",
          url: "https://example.com/git-deps",
        });
      }

      return advisories;
    },
    expectedExitCode: 0,
    expect: async ({ out }) => {
      await write("package.json", {
        name: "test-conditional",
        dependencies: {
          "bar": "^0.0.2",
          "git-dep": "git+https://github.com/example/repo.git",
        },
      });

      expect(out).toContain("WARN:");
      expect(out).toContain("pre-1.0 version");
      expect(out).toContain("Git dependencies");
    },
  });
});
