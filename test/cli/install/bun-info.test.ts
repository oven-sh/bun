import { spawn } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDirWithFiles } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

describe.concurrent("bun info", () => {
  let i = 0;
  function setupTest() {
    const testDir = tempDirWithFiles("view-" + i++, {
      "package.json": JSON.stringify({
        // Since npm reserved the "fs" package name, we know that the "fs" package isn't going to update randomly later on.
        name: "fs",

        version: "1.0.0",
      }),
    });
    return testDir;
  }

  async function runCommand(cmd: string[], testDir: string, env = bunEnv) {
    const { stdout, stderr, exited } = spawn({
      cmd,
      cwd: testDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });

    const [output, error, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);

    return { output, error, code: exitCode };
  }

  describe("bun info (main command)", () => {
    it("should display package info for latest version", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "info", "is-number"], testDir);

      expect(code).toBe(0);
      expect(error).toBe("");
      expect(output).toContain("is-number@");
      expect(output).toContain("Returns true if a number"); // Part of the package description
      expect(output).toContain("maintainers:");
    });

    it("should display package info for specific version", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "info", "is-number@7.0.0"], testDir);
      expect(code).toBe(0);
      expect(output).toMatchInlineSnapshot(`
        "is-number@7.0.0 | MIT | deps: 0 | versions: 15
        Returns true if a number or string value is a finite number. Useful for regex matches, parsing, user input, etc.
        https://github.com/jonschlinkert/is-number
        keywords: cast, check, coerce, coercion, finite, integer, is, isnan, is-nan, is-num, is-number, isnumber, isfinite, istype, kind, math, nan, num, number, numeric, parseFloat, parseInt, test, type, typeof, value

        dist
         .tarball: https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz
         .shasum: 7535345b896734d5f80c4d06c50955527a14f12b
         .integrity: sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==
         .unpackedSize: 9.62 KB

        dist-tags:
        latest: 7.0.0

        maintainers:
        - doowb <brian.woodward@gmail.com>
        - jonschlinkert <github@sellside.com>
        - realityking <me@rouvenwessling.de>

        Published: 2018-07-04T15:08:58.238Z
        "
      `);
    });

    it("should display specific property", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "info", "@types/bun", "name"], testDir);

      expect(error).toBe("");
      expect(output.trim().length).toBeGreaterThan(0);
      expect(output).toMatchInlineSnapshot(`
        "@types/bun
        "
      `);
      expect(code).toBe(0);
    });

    it("should handle missing arguments", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "info"], testDir);

      expect(output).toMatchInlineSnapshot(`
        "fs@0.0.1-security | ISC | deps: 0 | versions: 3
        This package name is not currently in use, but was formerly occupied by another package. To avoid malicious use, npm is hanging on to the package name, but loosely, and we'll probably give it to you if you want it.
        https://github.com/npm/security-holder#readme

        dist
         .tarball: https://registry.npmjs.org/fs/-/fs-0.0.1-security.tgz
         .shasum: 8a7bd37186b6dddf3813f23858b57ecaaf5e41d4
         .integrity: sha512-3XY9e1pP0CVEUCdj5BmfIZxRBTSDycnbqhIOGec9QYtmVH2fbLpj86CFWkrNOkt/Fvty4KZG5lTglL9j/gJ87w==

        dist-tags:
        latest: 0.0.1-security

        maintainers:
        - npm <npm@npmjs.com>

        Published: 2016-08-23T17:56:58.976Z
        "
      `);
      expect(code).toBe(0);
    });
  });

  describe("bun pm view (alias)", () => {
    it("should display package info for latest version", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number"], testDir);

      expect(code).toBe(0);
      expect(error).toBe("");
      expect(output).toContain("is-number@");
      expect(output).toContain("Returns true if a number"); // Part of the package description
      expect(output).toContain("maintainers:");
    });

    it("should display package info for specific version", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number@7.0.0"], testDir);
      expect(code).toBe(0);
      expect(output).toMatchInlineSnapshot(`
        "is-number@7.0.0 | MIT | deps: 0 | versions: 15
        Returns true if a number or string value is a finite number. Useful for regex matches, parsing, user input, etc.
        https://github.com/jonschlinkert/is-number
        keywords: cast, check, coerce, coercion, finite, integer, is, isnan, is-nan, is-num, is-number, isnumber, isfinite, istype, kind, math, nan, num, number, numeric, parseFloat, parseInt, test, type, typeof, value

        dist
         .tarball: https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz
         .shasum: 7535345b896734d5f80c4d06c50955527a14f12b
         .integrity: sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==
         .unpackedSize: 9.62 KB

        dist-tags:
        latest: 7.0.0

        maintainers:
        - doowb <brian.woodward@gmail.com>
        - jonschlinkert <github@sellside.com>
        - realityking <me@rouvenwessling.de>

        Published: 2018-07-04T15:08:58.238Z
        "
      `);
    });

    it("should display specific property", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "@types/bun", "name"], testDir);

      expect(error).toBe("");
      expect(output.trim().length).toBeGreaterThan(0);
      expect(output).toMatchInlineSnapshot(`
        "@types/bun
        "
      `);
      expect(code).toBe(0);
    });

    it("should display nested property", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand(
        [bunExe(), "pm", "view", "is-number", "repository.url"],
        testDir,
      );

      expect(code).toBe(0);
      expect(error).toBe("");
      expect(output.trim()).toContain("https://");
    });

    // TODO: JSON output needs to be fixed to show specific version data, not full registry manifest
    it("should output JSON format with --json flag", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number@7.0.0", "--json"], testDir);

      expect(code).toBe(0);
      expect(error).toBe("");

      // Parse the JSON to verify it's valid
      const json = JSON.parse(output);
      expect(json).toMatchObject({
        name: "is-number",
        version: "7.0.0",
        description:
          "Returns true if a number or string value is a finite number. Useful for regex matches, parsing, user input, etc.",
        license: "MIT",
        homepage: "https://github.com/jonschlinkert/is-number",
        author: {
          name: "Jon Schlinkert",
          url: "https://github.com/jonschlinkert",
        },
        repository: {
          type: "git",
          url: expect.stringContaining("github.com/jonschlinkert/is-number"),
        },
        main: "index.js",
        engines: {
          node: ">=0.12.0",
        },
      });
    });

    it("should handle non-existent package", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "nonexistent-package-12345"], testDir);

      expect(code).toBe(1);
      expect(error).toContain("Not Found");
      expect(output).toBe("");
    });

    // TODO: Version validation needs to be fixed - currently falls back to first version instead of failing
    it("should handle non-existent version", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number@999.0.0"], testDir);

      expect(error).toMatchInlineSnapshot(`
        "error: No version of "is-number" satisfying "999.0.0" found

        Recent versions:
        - 4.0.0
        - 5.0.0
        - 6.0.0
        - 7.0.0
        - 7.0.0
          ... and 11 more
        "
      `);
      expect(code).toBe(1);
    });

    it("should handle non-existent property", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number", "nonexistent"], testDir);

      expect(error).toMatchInlineSnapshot(`
        "error: Property nonexistent not found
        "
      `);
      expect(code).toBe(1);
    });

    it("should handle malformed package specifier", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "@"], testDir);

      expect(code).toBe(1);
      expect(error).toContain("Method Not Allowed");
      expect(output).toBe("");
    });

    it("should handle scoped packages", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "@types/semver"], testDir);

      expect(code).toBe(0);
      expect(error).toBe("");
      expect(output).toContain("@types/semver@");
      expect(output).toContain("TypeScript definitions");
    });

    it("should handle .", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "."], testDir);

      expect(output).toMatchInlineSnapshot(`
        "fs@0.0.1-security | ISC | deps: 0 | versions: 3
        This package name is not currently in use, but was formerly occupied by another package. To avoid malicious use, npm is hanging on to the package name, but loosely, and we'll probably give it to you if you want it.
        https://github.com/npm/security-holder#readme

        dist
         .tarball: https://registry.npmjs.org/fs/-/fs-0.0.1-security.tgz
         .shasum: 8a7bd37186b6dddf3813f23858b57ecaaf5e41d4
         .integrity: sha512-3XY9e1pP0CVEUCdj5BmfIZxRBTSDycnbqhIOGec9QYtmVH2fbLpj86CFWkrNOkt/Fvty4KZG5lTglL9j/gJ87w==

        dist-tags:
        latest: 0.0.1-security

        maintainers:
        - npm <npm@npmjs.com>

        Published: 2016-08-23T17:56:58.976Z
        "
      `);
      expect(code).toBe(0);
    });

    it("should handle version ranges", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number@^7.0.0"], testDir);

      expect(code).toBe(0);
      expect(error).toBe("");
      expect(output).toContain("is-number@7.");
      expect(output).toContain("Returns true if a number");
    });

    it("versions should work", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "fs", "versions"], testDir);

      expect(error).toBe("");
      expect(output).toMatchInlineSnapshot(`
        "[
          "0.0.1-security",
          "0.0.0",
          "0.0.2"
        ]
        "
      `);
      expect(code).toBe(0);
    });

    it("versions[0] should work", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "fs", "versions[0]"], testDir);

      expect(error).toBe("");
      expect(output).toMatchInlineSnapshot(`
        "0.0.1-security
        "
      `);
      expect(code).toBe(0);
    });

    it("should handle dist-tags like latest", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "fs@latest"], testDir);

      expect(code).toBe(0);
      expect(error).toBe("");
      expect(output).toContain("0.0.1-security"); // latest should resolve to 7.0.0
      expect(output).toMatchInlineSnapshot(`
        "fs@0.0.1-security | ISC | deps: 0 | versions: 3
        This package name is not currently in use, but was formerly occupied by another package. To avoid malicious use, npm is hanging on to the package name, but loosely, and we'll probably give it to you if you want it.
        https://github.com/npm/security-holder#readme

        dist
         .tarball: https://registry.npmjs.org/fs/-/fs-0.0.1-security.tgz
         .shasum: 8a7bd37186b6dddf3813f23858b57ecaaf5e41d4
         .integrity: sha512-3XY9e1pP0CVEUCdj5BmfIZxRBTSDycnbqhIOGec9QYtmVH2fbLpj86CFWkrNOkt/Fvty4KZG5lTglL9j/gJ87w==

        dist-tags:
        latest: 0.0.1-security

        maintainers:
        - npm <npm@npmjs.com>

        Published: 2016-08-23T17:56:58.976Z
        "
      `);
    });
  });

  describe("without a package.json", () => {
    function isolatedRegistryEnv(homeDir: string, xdgConfigDir: string, overrides: Record<string, string> = {}) {
      return {
        ...bunEnv,
        HOME: homeDir,
        USERPROFILE: homeDir,
        XDG_CONFIG_HOME: xdgConfigDir,
        BUN_CONFIG_REGISTRY: "",
        NPM_CONFIG_REGISTRY: "",
        npm_config_registry: "",
        BUN_CONFIG_TOKEN: "",
        NPM_CONFIG_TOKEN: "",
        npm_config_token: "",
        http_proxy: "",
        https_proxy: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ...overrides,
      };
    }

    const manifestlessCases = [
      {
        name: "bun info with a versioned spec and bunfig.toml",
        args: ["info", "manifestless-pkg@1.0.0", "name"],
        packageName: "manifestless-pkg",
        config: "bunfig",
      },
      {
        name: "bun pm view with a scoped versioned spec and .npmrc",
        args: ["pm", "view", "@scope/manifestless-pkg@1.0.0", "name"],
        packageName: "@scope/manifestless-pkg",
        config: "npmrc",
      },
      {
        name: "bun info with a versioned spec and environment config",
        args: ["info", "manifestless-env-pkg@1.0.0", "name"],
        packageName: "manifestless-env-pkg",
        config: "env",
      },
      {
        name: "bun info with --registry before the spec",
        args: ["info", "--registry", "$REGISTRY", "manifestless-option-before-pkg@1.0.0", "name"],
        packageName: "manifestless-option-before-pkg",
        config: "option-before",
      },
      {
        name: "bun info with --registry after the spec",
        args: ["info", "manifestless-option-after-pkg@1.0.0", "--registry", "$REGISTRY", "name"],
        packageName: "manifestless-option-after-pkg",
        config: "option-after",
      },
      {
        name: "bun info with a leading-hyphen package after --",
        args: ["info", "--", "-manifestless-pkg@1.0.0", "name"],
        packageName: "-manifestless-pkg",
        config: "env-leading-hyphen",
      },
    ] as const;

    test.each(manifestlessCases)("$name", async ({ args, packageName, config }) => {
      const token = "manifestless-registry-token";
      const manifest = JSON.stringify({
        name: packageName,
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": {
            name: packageName,
            version: "1.0.0",
            dist: {
              tarball: "http://localhost/manifestless-pkg-1.0.0.tgz",
              shasum: "0".repeat(40),
            },
          },
        },
        time: { "1.0.0": "2020-01-01T00:00:00.000Z" },
      });
      const requests: { packageName: string; authorization: string | null }[] = [];
      await using server = Bun.serve({
        port: 0,
        fetch(request) {
          requests.push({
            packageName: decodeURIComponent(new URL(request.url).pathname.slice(1)),
            authorization: request.headers.get("authorization"),
          });
          return new Response(manifest, { headers: { "content-type": "application/json" } });
        },
      });
      const registry = `http://127.0.0.1:${server.port}/`;
      const testDir = tempDirWithFiles(`bun-info-manifestless-${config}`, {
        ...(config === "bunfig"
          ? {
              "bunfig.toml": `[install.registry]\nurl = "${registry}"\ntoken = "${token}"\n`,
            }
          : config === "npmrc"
            ? {
                ".npmrc": `registry=${registry}\n//127.0.0.1:${server.port}/:_authToken=${token}\n`,
              }
            : {}),
      });
      const homeDir = tempDirWithFiles(`bun-info-manifestless-home-${config}`, {});
      const xdgConfigDir = tempDirWithFiles(`bun-info-manifestless-xdg-${config}`, {});
      const filesBefore = readdirSync(testDir).sort();
      const homeFilesBefore = readdirSync(homeDir).sort();
      const xdgFilesBefore = readdirSync(xdgConfigDir).sort();
      expect(homeFilesBefore).toEqual([]);
      expect(xdgFilesBefore).toEqual([]);
      const resolvedArgs = args.map(arg => (arg === "$REGISTRY" ? registry : arg));

      const { output, error, code } = await runCommand(
        [bunExe(), ...resolvedArgs],
        testDir,
        isolatedRegistryEnv(homeDir, xdgConfigDir, {
          BUN_CONFIG_REGISTRY: config.startsWith("env") ? registry : "",
          BUN_CONFIG_TOKEN: config.startsWith("env") ? token : "",
        }),
      );

      expect({ output, error, code, requests, files: readdirSync(testDir).sort() }).toEqual({
        output: `${packageName}\n`,
        error: "",
        code: 0,
        requests: [{ packageName, authorization: config.startsWith("option") ? null : `Bearer ${token}` }],
        files: filesBefore,
      });
      expect(readdirSync(homeDir).sort()).toEqual(homeFilesBefore);
      expect(readdirSync(xdgConfigDir).sort()).toEqual(xdgFilesBefore);
    });

    test.each([
      { name: "bun info", args: ["info"] },
      { name: "bun info .", args: ["info", "."] },
      { name: "bun info with a path", args: ["info", "./package.json"] },
      { name: "bun info with a URL", args: ["info", "https://example.com/package.tgz"] },
      { name: "bun info with malformed package syntax", args: ["info", "@"] },
      { name: "bun info with only a valued registry option", args: ["info", "--registry", "$REGISTRY"] },
      { name: "bun pm view", args: ["pm", "view"] },
      { name: "bun pm view .", args: ["pm", "view", "."] },
      { name: "bun pm view with a path", args: ["pm", "view", "./package.json"] },
      { name: "bun pm view with a URL", args: ["pm", "view", "https://example.com/package.tgz"] },
      { name: "bun pm view with malformed package syntax", args: ["pm", "view", "@"] },
    ])("$name still requires project context", async ({ args }) => {
      let requestCount = 0;
      await using server = Bun.serve({
        port: 0,
        fetch() {
          requestCount++;
          return new Response(null, { status: 500 });
        },
      });
      const testDir = tempDirWithFiles("bun-info-project-context", {
        "bunfig.toml": `install.registry = "http://127.0.0.1:${server.port}/"\n`,
      });
      const homeDir = tempDirWithFiles("bun-info-project-context-home", {});
      const xdgConfigDir = tempDirWithFiles("bun-info-project-context-xdg", {});
      const filesBefore = readdirSync(testDir).sort();
      const homeFilesBefore = readdirSync(homeDir).sort();
      const xdgFilesBefore = readdirSync(xdgConfigDir).sort();
      expect(homeFilesBefore).toEqual([]);
      expect(xdgFilesBefore).toEqual([]);
      const resolvedArgs = args.map(arg => (arg === "$REGISTRY" ? `http://127.0.0.1:${server.port}/` : arg));

      const { error, code } = await runCommand(
        [bunExe(), ...resolvedArgs],
        testDir,
        isolatedRegistryEnv(homeDir, xdgConfigDir),
      );

      expect(code).toBe(1);
      expect(error).toContain("package.json");
      expect(requestCount).toBe(0);
      expect(readdirSync(testDir).sort()).toEqual(filesBefore);
      expect(readdirSync(homeDir).sort()).toEqual(homeFilesBefore);
      expect(readdirSync(xdgConfigDir).sort()).toEqual(xdgFilesBefore);
    });
  });
});

// LSan's default conservative scan only flags the `send_sync` response-metadata
// leak when no idle thread parks with a stale pointer in a callee-saved
// register; excluding registers as roots makes the check deterministic.
test.skipIf(!isASAN)(
  "bun info does not leak the sync response metadata",
  async () => {
    const manifest = JSON.stringify({
      name: "leakpkg",
      "dist-tags": { latest: "0.0.1" },
      versions: {
        "0.0.1": {
          name: "leakpkg",
          version: "0.0.1",
          dist: { tarball: "http://localhost/leakpkg-0.0.1.tgz", shasum: "0".repeat(40) },
        },
      },
      time: { "0.0.1": "2020-01-01T00:00:00.000Z" },
    });
    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(manifest, { headers: { "content-type": "application/json" } });
      },
    });
    const dir = tempDirWithFiles("bun-info-lsan", {
      "package.json": JSON.stringify({ name: "test", version: "1.0.0" }),
      "bunfig.toml": Bun.TOML.stringify({
        install: {
          registry: `http://localhost:${server.port}/`,
        },
      }),
    });
    await using proc = spawn({
      cmd: [bunExe(), "info", "leakpkg", "name"],
      cwd: dir,
      env: {
        ...bunEnv,
        http_proxy: "",
        https_proxy: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `use_registers=0:print_suppressions=0:suppressions=${join(import.meta.dirname, "../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: "leakpkg",
      stderr: expect.not.stringContaining("LeakSanitizer: detected memory leaks"),
      exitCode: 0,
    });
    // Timeout: a detected leak makes llvm-symbolizer load the full DWARF of the
    // test binary before the assertion above can run; the no-leak path is < 1s.
  },
  30_000,
);
