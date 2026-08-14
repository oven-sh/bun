import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, DirectoryTree, gunzipJsonRequest, lazyPromiseLike, tempDir } from "harness";
import { join } from "node:path";
import { resolveBulkAdvisoryFixture } from "./registry/fixtures/audit/audit-fixtures";

function fixture(
  folder:
    | "express@3"
    | "vuln-with-only-dev-dependencies"
    | "safe-is-number@7"
    | "mix-of-safe-and-vulnerable-dependencies",
) {
  return join(import.meta.dirname, "registry", "fixtures", "audit", folder);
}

let server: Bun.Server;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: async req => {
      const body = await gunzipJsonRequest(req);

      const fixture = resolveBulkAdvisoryFixture(body);

      if (!fixture) {
        console.log("No fixture found for", body);
        return new Response("No fixture found", { status: 404 });
      }

      return Response.json(fixture);
    },
  });
});

afterAll(() => {
  server?.stop();
});

function doAuditTest(
  label: string,
  options: {
    args?: string[];
    exitCode: number;
    files: DirectoryTree | string;
    fn: (std: { stdout: PromiseLike<string>; stderr: PromiseLike<string>; dir: string }) => Promise<void>;
  },
) {
  test(label, async () => {
    await using dir = tempDir("bun-test-audit-" + label.replace(/[^a-zA-Z0-9]/g, "-"), options.files);

    const cmd = [bunExe(), "audit", ...(options.args ?? [])];

    const url = server.url.toString().slice(0, -1);

    const proc = spawn({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
      cwd: dir,
      env: {
        ...bunEnv,
        NPM_CONFIG_REGISTRY: url,
      },
    });

    const stdout = lazyPromiseLike(() => proc.stdout.text());
    const stderr = lazyPromiseLike(() => proc.stderr.text());

    const exitCode = await proc.exited;

    try {
      expect(exitCode).toBe(options.exitCode);
      await options.fn({ stdout, stderr, dir });
    } catch (e) {
      const err = await stderr;
      const out = await stdout;

      // useful to see what went wrong otherwise
      // we are just eating the rror silently

      console.log("ERR:", err);
      console.log("OUT:", out);

      throw e; //but still rethrow so test fails
    }
  });
}

describe("`bun audit`", () => {
  doAuditTest("should fail with no package.json", {
    exitCode: 1,
    files: {
      "README.md": "This place sure is empty...",
    },
    fn: async ({ stderr }) => {
      expect(await stderr).toContain("No package.json was found for directory");
    },
  });

  doAuditTest("should fail with package.json but no lockfile", {
    exitCode: 1,
    files: {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "express": "3",
        },
      }),
    },
    fn: async ({ stderr }) => {
      expect(await stderr).toContain("error: Lockfile not found");
    },
  });

  doAuditTest("should exit 0 when there are no dependencies in package.json", {
    exitCode: 0,
    files: {
      // i deemed this small enough to justify not needing a fixture
      "package.json": JSON.stringify({
        name: "empty-package",
        version: "1.0.0",
      }),
      "bun.lock": JSON.stringify({
        "lockfileVersion": 1,
        "workspaces": {
          "": {
            "name": "empty-package",
          },
        },
        "packages": {},
      }),
    },
    fn: async ({ stdout }) => {
      expect(await stdout).toBe("No vulnerabilities found\n");
    },
  });

  doAuditTest("should exit 0 when there are no vulnerabilities", {
    exitCode: 0,
    files: fixture("safe-is-number@7"),
    fn: async ({ stdout }) => {
      expect(await stdout).toBe("No vulnerabilities found\n");
    },
  });

  doAuditTest("should exit code 1 when there are vulnerabilities", {
    exitCode: 1,
    files: fixture("express@3"),
    fn: async ({ stdout }) => {
      expect(await stdout).toMatchSnapshot("bun-audit-expect-vulnerabilities-found");
    },
  });

  doAuditTest("should print valid JSON and exit 0 when --json is passed and there are no vulnerabilities", {
    exitCode: 0,
    files: fixture("safe-is-number@7"),
    args: ["--json"],
    fn: async ({ stdout }) => {
      const out = await stdout;
      const json = JSON.parse(out); // this would throw making the test fail if the JSON was invalid
      expect(json).toMatchSnapshot("bun-audit-expect-valid-json-stdout-report-no-vulnerabilities");
    },
  });

  doAuditTest("should print valid JSON and exit 1 when --json is passed and there are vulnerabilities", {
    exitCode: 1,
    files: fixture("express@3"),
    args: ["--json"],
    fn: async ({ stdout }) => {
      const out = await stdout;
      const json = JSON.parse(out); // this would throw making the test fail if the JSON was invalid
      expect(json).toMatchSnapshot("bun-audit-expect-valid-json-stdout-report-vulnerabilities");
    },
  });

  doAuditTest(
    "should exit 1 and behave exactly the same when there are vulnerabilities when only devDependencies are specified",
    {
      exitCode: 1,
      files: fixture("vuln-with-only-dev-dependencies"),
      fn: async ({ stdout }) => {
        expect(await stdout).toMatchSnapshot("bun-audit-expect-vulnerabilities-found");
      },
    },
  );

  doAuditTest(
    "when a project has some safe dependencies and some vulnerable dependencies, we should not print the safe dependencies",
    {
      exitCode: 1,
      files: fixture("mix-of-safe-and-vulnerable-dependencies"),
      fn: async ({ stdout }) => {
        // this fixture is using a safe version of is-number and an unsafe version of ms
        // so we want to check that `is-number` is not included in the output and that `ms` is

        const out = await stdout;

        expect(out).toContain("ms");
        expect(out).not.toContain("is-number");

        expect(out).toMatchSnapshot("bun-audit-expect-vulnerabilities-found");
      },
    },
  );

  const fakeIntegrity = // this is just random/fake data as the integrity check is not important for this test
    "sha512-V8E0l1jyyeSSS9R+J9oljx5eq2rqzClInuwaPcyuv0Mm3ViI/3/rcc4rCEO8i4eQ4I0O0FAGYDA2i5xWHHPhzg==";

  doAuditTest(
    "packages that come from non-default registries should be ignored from the audit, however they should get surfaced at the bottom of the output that they got skipped",
    {
      exitCode: 0,
      files: {
        "package.json": JSON.stringify({
          name: "test",
          version: "1.0.0",
          dependencies: {
            "@foo/bar": "1.0.0",
            "@foo/baz": "1.0.0",
          },
        }),
        "bun.lock": JSON.stringify({
          "lockfileVersion": 1,
          "workspaces": {
            "": {
              "name": "test",
            },
          },
          "packages": {
            "@foo/bar": ["@foo/bar@1.0.0", "", {}, fakeIntegrity],
            "@foo/baz": ["@foo/baz@1.0.0", "", {}, fakeIntegrity],
          },
        }),
        //prettier-ignore
        ".npmrc": [
          `registry=https://registry.npmjs.org`,
          `@foo:registry=https://my-registry.example.com`,
        ].join("\n"),
      },
      fn: async ({ stdout }) => {
        const out = await stdout;

        expect(out).toContain("Skipped @foo/bar, @foo/baz because they do not come from the default registry");
        expect(out).toContain("No vulnerabilities found");
      },
    },
  );

  doAuditTest("workspaces print the path to the vulnerable package and include workspace:pkg in the name", {
    exitCode: 1,
    files: {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        workspaces: ["a"],
      }),

      "a/package.json": JSON.stringify({
        "name": "a",
        "dependencies": {
          "ms": "0.7.0",
        },
      }),

      "bun.lock": JSON.stringify({
        "lockfileVersion": 1,
        "workspaces": {
          "": {
            "name": "bun-audit-playground",
          },
          "a": {
            "name": "a",
            "dependencies": {
              "ms": "0.7.0",
            },
          },
        },
        "packages": {
          "a": ["a@workspace:a"],
          "ms": ["ms@0.7.0", "", {}, fakeIntegrity],
        },
      }),
    },
    fn: async ({ stdout }) => {
      expect(await stdout).toInclude("workspace:a › ms");
    },
  });

  doAuditTest("--audit-level critical only shows critical vulnerabilities", {
    exitCode: 1,
    files: fixture("express@3"),
    args: ["--audit-level", "critical"],
    fn: async ({ stdout, stderr }) => {
      expect(await stderr).not.toContain("invalid `--audit-level` value");
      const output = await stdout;
      expect(output).toContain("critical:");
      expect(output).not.toContain("moderate:");
      expect(output).not.toContain("high:");
      expect(output).not.toContain("low:");
    },
  });

  doAuditTest("--audit-level validates input and rejects invalid levels", {
    exitCode: 1,
    files: fixture("safe-is-number@7"),
    args: ["--audit-level", "invalid"],
    fn: async ({ stderr }) => {
      expect(await stderr).toContain("invalid `--audit-level` value");
      expect(await stderr).toContain("Valid values are: low, moderate, high, critical");
    },
  });

  doAuditTest("--audit-level accepts all valid severity levels", {
    exitCode: 0,
    files: fixture("safe-is-number@7"),
    args: ["--audit-level", "moderate"],
    fn: async ({ stdout, stderr }) => {
      expect(await stderr).not.toContain("invalid `--audit-level` value");
      expect(await stdout).toContain("No vulnerabilities found");
    },
  });

  doAuditTest("--prod flag is recognized and doesn't cause errors", {
    exitCode: 1,
    files: fixture("mix-of-safe-and-vulnerable-dependencies"),
    args: ["--prod"],
    fn: async ({ stdout, stderr }) => {
      expect(await stderr).not.toContain("error");
      expect(await stdout).toContain("vulnerabilities");
    },
  });

  doAuditTest("--ignore flag filters out specific CVE IDs", {
    exitCode: 1,
    files: fixture("express@3"),
    args: ["--ignore", "GHSA-gwg9-rgvj-4h5j"],
    fn: async ({ stdout, stderr }) => {
      expect(await stderr).not.toContain("error");
      const output = await stdout;
      expect(output).not.toContain("GHSA-gwg9-rgvj-4h5j");
      expect(output).toContain("vulnerabilities");
    },
  });

  test("sends a well-formed JSON request body when a package name contains a double quote", async () => {
    const packageName = 'a"b';
    using dirHandle = tempDir("bun-test-audit-name-with-quote", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          [packageName]: "1.0.0",
        },
      }),
      "bun.lock": JSON.stringify({
        "lockfileVersion": 1,
        "workspaces": {
          "": {
            "name": "test",
            "dependencies": {
              [packageName]: "1.0.0",
            },
          },
        },
        "packages": {
          [packageName]: [`${packageName}@1.0.0`, "", {}, fakeIntegrity],
        },
      }),
    });
    const dir = String(dirHandle);

    let receivedBody = "";
    await using auditServer = Bun.serve({
      port: 0,
      fetch: async req => {
        receivedBody = Buffer.from(Bun.gunzipSync(await req.arrayBuffer())).toString("utf-8");
        return Response.json({});
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "audit"],
      stdout: "pipe",
      stderr: "pipe",
      cwd: dir,
      env: {
        ...bunEnv,
        NPM_CONFIG_REGISTRY: auditServer.url.href,
      },
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(JSON.parse(receivedBody)).toEqual({ [packageName]: ["1.0.0"] });
    expect(stdout).toBe("No vulnerabilities found\n");
    expect(exitCode).toBe(0);
  });

  describe("registry responses", () => {
    const projectDependingOnMs: DirectoryTree = {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          ms: "0.7.0",
        },
      }),
      "bun.lock": JSON.stringify({
        "lockfileVersion": 1,
        "workspaces": {
          "": {
            "name": "test",
            "dependencies": {
              ms: "0.7.0",
            },
          },
        },
        "packages": {
          ms: ["ms@0.7.0", "", {}, fakeIntegrity],
        },
      }),
    };

    async function auditAgainst(responseBody: string, args: string[] = []) {
      await using registry = Bun.serve({
        port: 0,
        fetch: () => new Response(responseBody, { headers: { "content-type": "application/json" } }),
      });
      using dir = tempDir("bun-test-audit-registry-response", projectDependingOnMs);

      await using proc = spawn({
        cmd: [bunExe(), "audit", ...args],
        cwd: String(dir),
        env: { ...bunEnv, NPM_CONFIG_REGISTRY: registry.url.href },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const [banner, ...rest] = stderr.split("\n");
      expect(banner).toStartWith("bun audit v");

      const auditUrl = `${registry.url.origin}/-/npm/v1/security/advisories/bulk`;
      return {
        result: { stdout, stderr: rest.join("\n"), exitCode },
        rejected: (expected: "JSON" | "a list of advisories") =>
          `error: audit request to ${auditUrl} failed: response is not ${expected}\n`,
      };
    }

    const notAdvisoryLists = [
      "[]",
      "null",
      '"all clear"',
      '{"error":"audit is not supported by this registry"}',
      '{"ms":{"severity":"high","title":"advisory object where the array should be"}}',
      '{"ms":["high"]}',
    ];

    test.concurrent.each(notAdvisoryLists)("%s is a failed audit, not a clean one", async responseBody => {
      const { result, rejected } = await auditAgainst(responseBody);
      expect(result).toEqual({ stdout: "", stderr: rejected("a list of advisories"), exitCode: 1 });
    });

    test.concurrent.each(notAdvisoryLists)("--json relays %s and exits 1", async responseBody => {
      const { result, rejected } = await auditAgainst(responseBody, ["--json"]);
      expect(result).toEqual({ stdout: `${responseBody}\n`, stderr: rejected("a list of advisories"), exitCode: 1 });
    });

    const notJson = ["<html>\x1b[2J\x1b]0;owned\x07sign in to continue</html>", "Not Found"];

    test.concurrent.each(notJson)("a non-JSON body (%j) is neither echoed nor a clean audit", async responseBody => {
      const { result, rejected } = await auditAgainst(responseBody);
      expect(result).toEqual({ stdout: "", stderr: rejected("JSON"), exitCode: 1 });
    });

    test.concurrent.each(notJson)("--json does not echo a non-JSON body (%j) either", async responseBody => {
      const { result, rejected } = await auditAgainst(responseBody, ["--json"]);
      expect(result).toEqual({ stdout: "", stderr: rejected("JSON"), exitCode: 1 });
    });

    test.concurrent("a package listed with no advisories is a clean audit", async () => {
      const { result } = await auditAgainst('{"ms":[]}');
      expect(result).toEqual({ stdout: "No vulnerabilities found\n", stderr: "", exitCode: 0 });
    });

    test.concurrent("--json exits 0 when the packages are listed with no advisories", async () => {
      const { result } = await auditAgainst('{"ms":[]}', ["--json"]);
      expect(result).toEqual({ stdout: '{"ms":[]}\n', stderr: "", exitCode: 0 });
    });

    test.concurrent("an empty body is a clean audit", async () => {
      const { result } = await auditAgainst("");
      expect(result).toEqual({ stdout: "No vulnerabilities found\n", stderr: "", exitCode: 0 });
    });

    test.concurrent("--audit-level filtering out every advisory prints a clean audit, not nothing", async () => {
      const { result } = await auditAgainst(
        JSON.stringify({ ms: [{ severity: "low", title: "minor", url: "https://example.com/minor" }] }),
        ["--audit-level", "critical"],
      );
      expect(result).toEqual({ stdout: "No vulnerabilities found\n", stderr: "", exitCode: 0 });
    });

    test.concurrent("control characters in advisories and package names are escaped in the report", async () => {
      const { result } = await auditAgainst(
        JSON.stringify({
          ms: [
            {
              severity: "high",
              title: "ms \x1b[2J\x1b]0;owned\x07 ReDoS in \\d+\r\n\tparsing\x7f \x9b \u00a9 2015",
              url: "https://example.com/ms\x1b]8;;https://evil.example/\x07",
              vulnerable_versions: "<2.0.0\x1b[0m",
            },
          ],
          "ms\x1b[31m": [{ severity: "critical", title: "not a real package", url: "https://example.com/fake" }],
        }),
      );
      expect(result).toEqual({
        stdout: [
          "ms  <2.0.0\\u001b[0m",
          "  (direct dependency)",
          "  high: ms \\u001b[2J\\u001b]0;owned\\u0007 ReDoS in \\d+\\r\\n\\tparsing\\u007f \\u009b \u00a9 2015 - https://example.com/ms\\u001b]8;;https://evil.example/\\u0007",
          "",
          "ms\\u001b[31m",
          "  critical: not a real package - https://example.com/fake",
          "",
          "2 vulnerabilities (1 critical, 1 high)",
          "",
          "To update all dependencies to the latest compatible versions:",
          "  bun update",
          "",
          "To update all dependencies to the latest versions (including breaking changes):",
          "  bun update --latest",
          "",
          "",
        ].join("\n"),
        stderr: "",
        exitCode: 1,
      });
    });
  });
});
