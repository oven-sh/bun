import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("bundler app option", () => {
  test("Bun.build accepts app option", async () => {
    if (!process.env.BUN_FEATURE_FLAG_BAKE) {
      console.log("Skipping test - Bake feature flag not enabled");
      return;
    }

    const dir = tempDirWithFiles("bundler-app-test", {
      "entry.ts": `console.log("Hello from entry");`,
      "minimal.server.ts": `
        export function registerClientReference() {
          return function() { throw new Error('Client reference') };
        }
        export default function handler() {
          return new Response('Hello');
        }
      `,
      "framework.ts": `
        export default {
          fileSystemRouterTypes: [
            {
              root: "routes",
              style: "nextjs-pages",
              serverEntryPoint: "./minimal.server.ts",
            },
          ],
          serverComponents: {
            separateSSRGraph: false,
            serverRuntimeImportSource: "./minimal.server.ts",
            serverRegisterClientReferenceExport: "registerClientReference",
          },
        };
      `,
      "test-build.ts": `
        // Test that Bun.build accepts the app option
        const result = await Bun.build({
          entrypoints: ["./entry.ts"],
          app: {
            framework: await import("./framework.ts").then(m => m.default),
            root: ".",
          }
        });
        
        if (result.success) {
          console.log("BUILD_SUCCESS");
        } else {
          console.log("BUILD_FAILED");
          for (const msg of result.logs) {
            console.log(msg);
          }
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test-build.ts"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout).toContain("BUILD_SUCCESS");
    if (exitCode !== 0) {
      console.error("STDOUT:", stdout);
      console.error("STDERR:", stderr);
    }
    expect(exitCode).toBe(0);
  });

  test("Bun.build app option requires bake feature flag", async () => {
    const dir = tempDirWithFiles("bundler-app-flag-test", {
      "entry.ts": `console.log("Hello from entry");`,
      "test-build.ts": `
        try {
          await Bun.build({
            entrypoints: ["./entry.ts"],
            app: {
              framework: {},
              root: ".",
            }
          });
          console.log("UNEXPECTED_SUCCESS");
        } catch (error) {
          if (error.message.includes("app option requires Bake feature flag")) {
            console.log("EXPECTED_ERROR");
          } else {
            console.log("UNEXPECTED_ERROR:", error.message);
          }
        }
      `,
    });

    const envWithoutBake = { ...bunEnv };
    delete envWithoutBake.BUN_FEATURE_FLAG_BAKE;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test-build.ts"],
      env: envWithoutBake,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout).toContain("EXPECTED_ERROR");
  });

  test("Bun.build app option validates framework", async () => {
    if (!process.env.BUN_FEATURE_FLAG_BAKE) {
      console.log("Skipping test - Bake feature flag not enabled");
      return;
    }

    const dir = tempDirWithFiles("bundler-app-validation-test", {
      "entry.ts": `console.log("Hello from entry");`,
      "test-build.ts": `
        try {
          await Bun.build({
            entrypoints: ["./entry.ts"],
            app: {
              // Missing framework field should cause an error
              root: ".",
            }
          });
          console.log("UNEXPECTED_SUCCESS");
        } catch (error) {
          if (error.message.includes("framework")) {
            console.log("EXPECTED_ERROR");
          } else {
            console.log("UNEXPECTED_ERROR:", error.message);
          }
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test-build.ts"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout).toContain("EXPECTED_ERROR");
  });
});