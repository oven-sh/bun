import { readableStreamToText, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, DirectoryTree, lazyPromiseLike, tempDirWithFiles, VerdaccioRegistry } from "harness";
import { join } from "node:path";

const registry = new VerdaccioRegistry();

function auditFixture(folder: "express3") {
  return join(import.meta.dirname, "registry", "fixtures", "audit", folder);
}

function fileFromAuditFixture(folder: "express3", path: string) {
  return Bun.file(join(auditFixture(folder), path));
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

describe("bun pm audit", async () => {
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

  doAuditTest("Should exit code 1 when there are vulnerabilities", {
    exitCode: 1,
    files: auditFixture("express3"),
    fn: async ({ stdout }) => {
      expect(await stdout).toContain("21 vulnerabilities (2 critical, 9 high, 4 moderate, 6 low)");
    },
  });

  doAuditTest("should print valid JSON only when --json is passed", {
    exitCode: 0,
    files: auditFixture("express3"),
    args: ["--json"],
    fn: async ({ stdout }) => {
      const out = await stdout;
      const json = JSON.parse(out);

      expect(json).toMatchSnapshot("bun-audit-expect-valid-json-stdout");
    },
  });
});
