import { $, readableStreamToText, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, DirectoryTree, gunzipJsonRequest, lazyPromiseLike, tempDirWithFiles } from "harness";
import { join } from "node:path";
import auditFixturesJson from "./registry/fixtures/audit/audit-fixtures.json" with { type: "json" };

const auditFixtures = (() => {
  const entries = Object.entries(auditFixturesJson);

  class AuditFixtureMap {
    private readonly map: Map<Record<string, string[]>, unknown> = new Map();

    public put(key: Record<string, string[]>, value: unknown) {
      this.map.set(key, value);
    }

    private static arrayHasExactlySameElementsButMaybeInDifferentOrder(a: string[], b: string[]) {
      if (a.length !== b.length) {
        return false;
      }

      return a.every(v => b.includes(v));
    }

    private static matches(a: Record<string, string[]>, b: Record<string, string[]>) {
      const entries = Object.entries(a);

      for (const [k, v] of entries) {
        if (!b[k]) {
          return false;
        }

        if (!AuditFixtureMap.arrayHasExactlySameElementsButMaybeInDifferentOrder(v, b[k])) {
          return false;
        }
      }

      return true;
    }

    public get(key: Record<string, string[]>) {
      for (const [k, v] of this.map.entries()) {
        if (AuditFixtureMap.matches(k, key)) {
          return v;
        }
      }

      return undefined;
    }
  }

  const map = new AuditFixtureMap();

  for (const [key, value] of entries) {
    map.put(JSON.parse(key), value);
  }

  return map;
})();

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
    fetch: async req => {
      const body = await gunzipJsonRequest(req);

      if (!auditFixtures.get(body)) {
        return new Response("No fixture found", { status: 404 });
      }

      const fixture = auditFixtures.get(body);

      return Response.json(fixture);
    },
  });
});

afterAll(() => {
  server.stop();
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
    const dir = tempDirWithFiles("bun-test-pm-audit-" + label.replace(/[^a-zA-Z0-9]/g, "-"), options.files);

    console.log(dir);

    await $`bun i`.cwd(dir).nothrow();

    const proc = spawn({
      cmd: [bunExe(), "pm", "audit", ...(options.args ?? [])],
      stdout: "pipe",
      stderr: "pipe",
      cwd: dir,
      env: {
        ...bunEnv,
        NPM_CONFIG_REGISTRY: server.url.toString(),
      },
    });

    const stdout = lazyPromiseLike(() => readableStreamToText(proc.stdout));
    const stderr = lazyPromiseLike(() => readableStreamToText(proc.stderr));

    const exitCode = await proc.exited;

    try {
      expect(exitCode).toBe(options.exitCode);
      await options.fn({ stdout, stderr, dir });
    } catch (e) {
      // const err = await stderr;
      // const out = await stdout;

      // // useful to see what went wrong otherwise
      // // we are just eating the rror silently
      // console.log(out.split("\n").join(">\n"));
      // console.log(err.split("\n").join(">\n"));

      throw e; //but still rethrow so test fails
    }
  });
}

describe("`bun pm audit`", () => {
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

  doAuditTest("should print valid JSON only when --json is passed", {
    exitCode: 0,
    files: fixture("express@3"),
    args: ["--json"],
    fn: async ({ stdout }) => {
      const out = await stdout;
      const json = JSON.parse(out); // this would throw making the test fail if the JSON was invalid

      expect(json).toMatchSnapshot("bun-audit-expect-valid-json-stdout");
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
});
