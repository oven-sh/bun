import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

/**
 * Tests for Node.js PR #60864: Allow `#/` patterns in subpath imports
 * https://github.com/nodejs/node/pull/60864
 *
 * Previously, subpath imports starting with `#/` were explicitly rejected.
 * The new behavior allows patterns like `{"imports": {"#/*": "./src/*"}}`
 * as a more practical alternative to the common `@/` pattern.
 */

describe("subpath imports with #/ patterns", () => {
  describe("wildcard #/* pattern", () => {
    it("resolves #/file via #/* wildcard pattern", async () => {
      const dir = tempDirWithFiles("subpath-slash-wildcard", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          imports: {
            "#/*": "./src/*",
          },
        }),
        "src/utils.js": "export const utils = 'utils';",
        "src/helpers.js": "export const helpers = 'helpers';",
        "index.js": `
          import { utils } from "#/utils.js";
          console.log(utils);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("utils");
      expect(exitCode).toBe(0);
    });

    it("resolves nested #/dir/file via #/* wildcard pattern", async () => {
      const dir = tempDirWithFiles("subpath-slash-nested", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          imports: {
            "#/*": "./src/*",
          },
        }),
        "src/lib/deep.js": "export const deep = 'deep';",
        "index.js": `
          import { deep } from "#/lib/deep.js";
          console.log(deep);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("deep");
      expect(exitCode).toBe(0);
    });

    it("works with extensionless imports via #/* pattern", async () => {
      const dir = tempDirWithFiles("subpath-slash-extensionless", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          imports: {
            "#/*": "./src/*.js",
          },
        }),
        "src/utils.js": "export const utils = 'utils';",
        "index.js": `
          import { utils } from "#/utils";
          console.log(utils);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("utils");
      expect(exitCode).toBe(0);
    });
  });

  describe("explicit #/name mappings", () => {
    it("resolves explicit #/foo mapping", async () => {
      const dir = tempDirWithFiles("subpath-slash-explicit", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          imports: {
            "#/utils": "./lib/utils.js",
          },
        }),
        "lib/utils.js": "export const utils = 'explicit-utils';",
        "index.js": `
          import { utils } from "#/utils";
          console.log(utils);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("explicit-utils");
      expect(exitCode).toBe(0);
    });

    it("resolves #/nested/path explicit mapping", async () => {
      const dir = tempDirWithFiles("subpath-slash-nested-explicit", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          imports: {
            "#/api/client": "./src/api/http-client.js",
          },
        }),
        "src/api/http-client.js": "export const client = 'http-client';",
        "index.js": `
          import { client } from "#/api/client";
          console.log(client);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("http-client");
      expect(exitCode).toBe(0);
    });
  });

  describe("conditional #/ imports", () => {
    it("resolves #/ with import/require conditions", async () => {
      const dir = tempDirWithFiles("subpath-slash-conditional", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          imports: {
            "#/env": {
              import: "./esm-env.js",
              require: "./cjs-env.js",
              default: "./default-env.js",
            },
          },
        }),
        "esm-env.js": "export const env = 'esm';",
        "cjs-env.js": "module.exports.env = 'cjs';",
        "default-env.js": "export const env = 'default';",
        "index.js": `
          import { env } from "#/env";
          console.log(env);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("esm");
      expect(exitCode).toBe(0);
    });

    it("resolves #/ with require condition in CommonJS", async () => {
      const dir = tempDirWithFiles("subpath-slash-conditional-cjs", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          type: "commonjs",
          imports: {
            "#/env": {
              import: "./esm-env.js",
              require: "./cjs-env.js",
              default: "./default-env.js",
            },
          },
        }),
        "esm-env.js": "export const env = 'esm';",
        "cjs-env.js": "module.exports.env = 'cjs';",
        "default-env.js": "export const env = 'default';",
        "index.js": `
          const { env } = require("#/env");
          console.log(env);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("cjs");
      expect(exitCode).toBe(0);
    });
  });

  describe("mixed # and #/ patterns", () => {
    it("distinguishes between #foo and #/foo patterns", async () => {
      const dir = tempDirWithFiles("subpath-slash-mixed", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          imports: {
            "#utils": "./hash-utils.js",
            "#/utils": "./slash-utils.js",
          },
        }),
        "hash-utils.js": "export const source = 'hash';",
        "slash-utils.js": "export const source = 'slash';",
        "index.js": `
          import { source as hashSource } from "#utils";
          import { source as slashSource } from "#/utils";
          console.log(hashSource, slashSource);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("hash slash");
      expect(exitCode).toBe(0);
    });

    it("prefers explicit #/path over #/* wildcard", async () => {
      const dir = tempDirWithFiles("subpath-slash-precedence", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          imports: {
            "#/*": "./src/*",
            "#/special": "./special.js",
          },
        }),
        "src/special.js": "export const source = 'wildcard';",
        "special.js": "export const source = 'explicit';",
        "index.js": `
          import { source } from "#/special";
          console.log(source);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("explicit");
      expect(exitCode).toBe(0);
    });
  });

  describe("symmetry with exports field", () => {
    it("supports symmetric exports and imports configuration", async () => {
      // This is the key use case from Node.js PR #60864:
      // { "exports": { "./*": "./src/*" }, "imports": { "#/*": "./src/*" } }
      const dir = tempDirWithFiles("subpath-slash-symmetric", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          exports: {
            "./*": "./src/*",
          },
          imports: {
            "#/*": "./src/*",
          },
        }),
        "src/utils.js": "export const utils = 'symmetric';",
        "index.js": `
          import { utils } from "#/utils.js";
          console.log(utils);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("symmetric");
      expect(exitCode).toBe(0);
    });
  });

  describe("import.meta.resolveSync with #/ patterns", () => {
    it("resolves #/ patterns via import.meta.resolveSync", async () => {
      const dir = tempDirWithFiles("subpath-slash-resolve", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          imports: {
            "#/*": "./src/*",
          },
        }),
        "src/target.js": "export default 'target';",
        "index.js": `
          const resolved = import.meta.resolveSync("#/target.js");
          console.log(resolved.endsWith("src/target.js"));
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("true");
      expect(exitCode).toBe(0);
    });
  });

  describe("require with #/ patterns", () => {
    it("resolves #/ patterns via require", async () => {
      const dir = tempDirWithFiles("subpath-slash-require", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          type: "commonjs",
          imports: {
            "#/*": "./src/*",
          },
        }),
        "src/utils.js": "module.exports.utils = 'cjs-utils';",
        "index.js": `
          const { utils } = require("#/utils.js");
          console.log(utils);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("cjs-utils");
      expect(exitCode).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("handles #/ at root with empty subpath (#/)", async () => {
      const dir = tempDirWithFiles("subpath-slash-root", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          imports: {
            "#/": "./src/index.js",
          },
        }),
        "src/index.js": "export const root = 'root';",
        "index.js": `
          import { root } from "#/";
          console.log(root);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("root");
      expect(exitCode).toBe(0);
    });

    it("handles #/ with null mapping (private internal)", async () => {
      const dir = tempDirWithFiles("subpath-slash-null", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          imports: {
            "#/*": "./src/*",
            "#/internal/*": null,
          },
        }),
        "src/public.js": "export const pub = 'public';",
        "src/internal/secret.js": "export const secret = 'secret';",
        "index.js": `
          try {
            await import("#/internal/secret.js");
            console.log("should-not-resolve");
          } catch (e) {
            // Output error message to verify rejection reason
            console.error(e.message);
            console.log("correctly-blocked");
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Verify the error mentions the blocked import path (ensures rejection is due to null mapping)
      expect(stderr).toContain("#/internal/secret.js");
      expect(stdout.trim()).toBe("correctly-blocked");
      expect(exitCode).toBe(0);
    });

    it("handles multiple slashes in path #/a/b/c", async () => {
      const dir = tempDirWithFiles("subpath-slash-deep", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          imports: {
            "#/*": "./src/*",
          },
        }),
        "src/a/b/c/deep.js": "export const deep = 'very-deep';",
        "index.js": `
          import { deep } from "#/a/b/c/deep.js";
          console.log(deep);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("very-deep");
      expect(exitCode).toBe(0);
    });
  });
});
