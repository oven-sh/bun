import { readableStreamToText, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, DirectoryTree, lazyPromiseLike, tempDirWithFiles, VerdaccioRegistry } from "harness";
import { join } from "node:path";

const registry = new VerdaccioRegistry();

function fixture(folder: "express@3" | "vuln-with-only-dev-dependencies" | "safe-is-number@7") {
  return join(import.meta.dirname, "registry", "fixtures", "audit", folder);
}

beforeAll(async () => await registry.start());
afterAll(() => registry.stop());

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
    const dir = tempDirWithFiles("bun-test-pm-audit", options.files);

    const proc = spawn({
      cmd: [bunExe(), "pm", "audit", ...(options.args ?? [])],
      stdout: "pipe",
      stderr: "pipe",
      cwd: dir,
      env: bunEnv,
    });

    const stdout = lazyPromiseLike(() => readableStreamToText(proc.stdout));
    const stderr = lazyPromiseLike(() => readableStreamToText(proc.stderr));

    const exitCode = await proc.exited;

    try {
      expect(exitCode).toBe(options.exitCode);
      await options.fn({ stdout, stderr, dir });
    } catch (e) {
      const out = await stdout;
      const err = await stderr;

      // useful to see what went wrong otherwise
      // we are just eating the rror silently
      console.log(out);
      console.log(err);

      throw e; //but still rethrow so test fails
    }
  });
}

describe("`bun pm audit`", () => {
  doAuditTest("Should fail with no package.json", {
    exitCode: 1,
    files: {
      "README.md": "This place sure is empty...",
    },
    fn: async ({ stderr }) => {
      expect(await stderr).toContain("No package.json was found for directory");
    },
  });

  doAuditTest("Should fail with package.json but no lockfile", {
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
      expect(await stdout).toBe("No vulnerabilities found.\n");
    },
  });

  doAuditTest("should exit 0 when there are no vulnerabilities", {
    exitCode: 0,
    files: fixture("safe-is-number@7"),
    fn: async ({ stdout }) => {
      expect(await stdout).toBe("No vulnerabilities found.\n");
    },
  });

  doAuditTest("Should exit code 1 when there are vulnerabilities", {
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
});
