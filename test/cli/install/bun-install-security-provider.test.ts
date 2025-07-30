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
    scanner: Bun.Install.Security.Provider["scan"] | string;
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

// Edge case tests
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

describe("Warning Level Advisories", () => {
  test("only warning level advisories", {
    scanner: async ({ packages }) => [
      {
        package: packages[0].name,
        description: "This is just a warning",
        level: "warn",
        url: "https://example.com/warning",
      },
    ],
    expectedExitCode: 0, // Should continue with warnings
    expect: ({ out }) => {
      expect(out).toContain("WARN: bar");
      expect(out).toContain("This is just a warning");
      expect(out).toContain("Security warnings found. Continuing anyway...");
      expect(out).not.toContain("Installation cancelled");
    },
  });

  test("mixed fatal and warn advisories", {
    scanner: async ({ packages }) => [
      {
        package: packages[0].name,
        description: "Warning advisory",
        level: "warn",
        url: "https://example.com/warning",
      },
      {
        package: packages[0].name,
        description: "Fatal advisory",
        level: "fatal",
        url: "https://example.com/fatal",
      },
    ],
    fails: true,
    expect: ({ out }) => {
      expect(out).toContain("WARN: bar");
      expect(out).toContain("FATAL: bar");
      expect(out).toContain("Installation cancelled due to fatal security issues");
    },
  });
});

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

test("receives transitive dependencies", {
  packages: ["depends-on-monkey"], // This package depends on monkey
  expectedExitCode: 0,
  scanner: async ({ packages }) => {
    for (const pkg of packages) console.log("Scanning:", pkg.name);
    return [];
  },
  expect: ({ out }) => {
    expect(out).toContain("Scanning: depends-on-monkey");
    expect(out).toContain("Scanning: monkey");
  },
});

// describe("Transitive Dependencies", () => {
//   test("scanner receives direct and transitive dependencies", {
//     scanner: async ({ packages }) => {
//       for (const pkg of packages) {
//         console.log("Scanning:", pkg.name);
//       }

//       return [];
//     },
//     packages: ["bar"],
//     expectedExitCode: 0,
//     expect: ({ out }) => {
//       expect(out).toContain("Scanning: baz");
//       expect(out).toContain("Scanning: bar");
//     },
//   });

//   test("scanner receives all metadata for transitive dependencies", {
//     scanner: async ({ packages }) => {
//       console.log(JSON.stringify(packages, null, 2));
//       return [];
//     },
//     packages: ["@barn/moo"],
//     expectedExitCode: 0,
//     expect: ({ out }) => {
//       // Verify scanner output contains transitive dep info
//       expect(out).toContain('"name":"bar"');
//       expect(out).toContain('"version":"0.0.2"');
//       expect(out).toContain('"name":"baz"');
//       expect(out).toContain('"registryUrl"');
//     },
//   });

//   test("scanner can flag vulnerabilities in transitive dependencies", {
//     scanner: async ({ packages }) => {
//       const transDep = packages.find(p => p.name === "bar");
//       if (transDep) {
//         return [
//           {
//             package: transDep.name,
//             description: "Vulnerability in transitive dependency bar",
//             level: "fatal",
//             url: "https://example.com/transitive-vuln",
//           },
//         ];
//       }
//       return [];
//     },
//     packages: ["@barn/moo"],
//     fails: true,
//     expect: ({ out }) => {
//       expect(out).toContain("FATAL: bar");
//       expect(out).toContain("Vulnerability in transitive dependency bar");
//     },
//   });

//   test("scanner handles multiple dependency trees", {
//     scanner: async ({ packages }) => {
//       console.log(`Received ${packages.length} packages:`);
//       for (const pkg of packages) {
//         console.log(`- ${pkg.name}@${pkg.version}`);
//       }
//       return [];
//     },
//     packages: ["@barn/moo", "qux"],
//     expectedExitCode: 0,
//     expect: ({ out }) => {
//       // Installing both @barn/moo and qux
//       // Should get: @barn/moo -> bar, baz, plus qux
//       expect(out).toContain("- @barn/moo@");
//       expect(out).toContain("- bar@0.0.2");
//       expect(out).toContain("- baz@");
//       expect(out).toContain("- qux@0.0.2");
//     },
//   });

//   test("scanner receives peer dependencies", {
//     scanner: async ({ packages }) => {
//       console.log("Packages with peer deps:");
//       for (const pkg of packages) {
//         console.log(`- ${pkg.name}@${pkg.version}`);
//       }
//       return [];
//     },
//     packages: ["boba"],
//     expectedExitCode: 0,
//     expect: ({ out }) => {
//       expect(out).toContain("- boba@0.0.2");
//       expect(out).toContain("- peer@");
//     },
//   });

//   test("scanner counts all packages including transitive", {
//     scanner: async ({ packages }) => {
//       console.log(`Total packages scanned: ${packages.length}`);
//       return [];
//     },
//     packages: ["@barn/moo"],
//     expectedExitCode: 0,
//     expect: ({ out }) => {
//       expect(out).toContain("Total packages scanned: 3");
//     },
//   });
// });
