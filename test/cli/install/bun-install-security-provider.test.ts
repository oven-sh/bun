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
beforeEach(async () => {
  await dummyBeforeEach();
});
afterEach(dummyAfterEach);

function test(
  name: string,
  options: {
    testTimeout?: number;
    scanner: Bun.Security.Scanner["scan"] | string;
    fails?: boolean;
    expect?: (std: { out: string; err: string }) => void | Promise<void>;
    expectedExitCode?: number;
    bunfigScanner?: string | false;
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
        const s = `export const scanner = {
  version: "1",
  scan: ${options.scanner.toString()},
};`;
        await write(scannerPath, s);
      }

      const bunfig = await read("./bunfig.toml").text();
      if (options.bunfigScanner !== false) {
        const scannerPath = options.bunfigScanner ?? "./scanner.ts";
        await write("./bunfig.toml", `${bunfig}\n[install.security]\nscanner = "${scannerPath}"`);
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
        expect(out).toContain("Installation aborted due to fatal security advisories");
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

test("shows progress message when scanner takes more than 1 second", {
  scanner: async () => {
    await Bun.sleep(2000);
    return [];
  },
  expect: async ({ err }) => {
    expect(err).toMatch(/\[\.\/scanner\.ts\] Scanning \d+ packages? took \d+ms/);
  },
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

describe("Security Scanner Edge Cases", () => {
  test("scanner module not found", {
    scanner: "dummy", // We need a scanner but will override the path
    bunfigScanner: "./non-existent-scanner.ts",
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain(
        "Security scanner './non-existent-scanner.ts' is configured in bunfig.toml but the file could not be found.\n  Please check that the file exists and the path is correct.",
      );
    },
  });

  test("scanner module throws during import", {
    scanner: `throw new Error("Module failed to load");`,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security scanner failed: Module failed to load");
    },
  });

  test("scanner missing version field", {
    scanner: `export const scanner = {
      scan: async () => []
    };`,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("with a version property");
    },
  });

  test("scanner wrong version", {
    scanner: `export const scanner = {
      version: "2",
      scan: async () => []
    };`,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security scanner must be version 1");
    },
  });

  test("scanner missing scan", {
    scanner: `export const scanner = {
      version: "1"
    };`,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("scanner.scan is not a function");
    },
  });

  test("scanner scan not a function", {
    scanner: `export const scanner = {
      version: "1",
      scan: "not a function"
    };`,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("scanner.scan is not a function");
    },
  });
});

// Invalid return value tests
describe("Invalid Return Values", () => {
  test("scanner returns non-array", {
    scanner: async () => "not an array" as any,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security scanner must return an array of advisories");
    },
  });

  test("scanner returns null", {
    scanner: async () => null as any,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security scanner must return an array of advisories");
    },
  });

  test("scanner returns undefined", {
    scanner: async () => undefined as any,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security scanner must return an array of advisories");
    },
  });

  test("scanner throws exception", {
    scanner: async () => {
      throw new Error("Scanner failed");
    },
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Scanner failed");
    },
  });

  test("scanner returns non-object in array", {
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
        // description field is completely missing
        level: "fatal",
        url: "https://example.com",
      } as any,
    ],
    fails: true,
    expect: ({ out }) => {
      // When field is missing, it's treated as null and installation proceeds
      expect(out).toContain("bar");
      expect(out).toContain("https://example.com");
    },
  });

  test("advisory with null description field", {
    scanner: async () => [
      {
        package: "bar",
        description: null,
        level: "fatal",
        url: "https://example.com",
      },
    ],
    fails: true,
    expect: ({ out }) => {
      // Should not print null description
      expect(out).not.toContain("null");
      expect(out).toContain("https://example.com");
    },
  });

  test("advisory with empty string description", {
    scanner: async () => [
      {
        package: "bar",
        description: "",
        level: "fatal",
        url: "https://example.com",
      },
    ],
    fails: true,
    expect: ({ out }) => {
      // Should not print empty description
      expect(out).toContain("bar");
      expect(out).toContain("https://example.com");
    },
  });

  test("advisory description field not string or null", {
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
      expect(err).toContain("Security advisory at index 0 'description' field must be a string or null");
    },
  });

  test("advisory missing url field", {
    scanner: async () => [
      {
        package: "bar",
        description: "Test advisory",
        // url field is completely missing
        level: "fatal",
      } as any,
    ],
    fails: true,
    expect: ({ out }) => {
      // When field is missing, it's treated as null and installation proceeds
      expect(out).toContain("Test advisory");
      expect(out).toContain("bar");
    },
  });

  test("advisory with null url field", {
    scanner: async () => [
      {
        package: "bar",
        description: "Test advisory",
        level: "fatal",
        url: null,
      },
    ],
    fails: true,
    expect: ({ out }) => {
      expect(out).toContain("Test advisory");
      // Should not print a URL line when url is null
      expect(out).not.toContain("https://");
      expect(out).not.toContain("http://");
    },
  });

  test("advisory with empty string url", {
    scanner: async () => [
      {
        package: "bar",
        description: "Has empty URL",
        level: "fatal",
        url: "",
      },
    ],
    fails: true,
    expect: ({ out }) => {
      expect(out).toContain("Has empty URL");
      // Should not print empty URL line at all
      expect(out).toContain("bar");
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

  test("advisory url field not string or null", {
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
      expect(err).toContain("Security advisory at index 0 'url' field must be a string or null");
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
        description: 123, // not a string or null
        level: "fatal",
        url: "https://example.com/2",
      } as any,
    ],
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security advisory at index 1 'description' field must be a string or null");
    },
  });
});

describe("Process Behavior", () => {
  test("scanner process exits early", {
    scanner: `
      console.log("Starting...");
      process.exit(42);
    `,
    expectedExitCode: 1,
    expect: ({ err }) => {
      expect(err).toContain("Security scanner exited with code 42 without sending data");
    },
  });
});

describe("Large Data Handling", () => {
  test("scanner returns many advisories", {
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

  test("scanner with very large response", {
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

describe("Multiple Package Scanning", () => {
  test("multiple packages scanned", {
    packages: ["bar", "qux"],
    scanner: async ({ packages }) => {
      return packages.map(pkg => ({
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
  test("advisory with both null description and url", {
    scanner: async ({ packages }) => [
      {
        package: packages[0].name,
        description: null,
        level: "fatal",
        url: null,
      },
    ],
    fails: true,
    expect: ({ out }) => {
      // Should show the package name and level but not null values
      expect(out).toContain("bar");
      expect(out).not.toContain("null");
    },
  });

  test("empty advisories array", {
    scanner: async () => [],
    expectedExitCode: 0,
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

describe("Package Resolution", () => {
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
