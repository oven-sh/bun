import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDirWithFiles } from "harness";
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

  async function runCommand(cmd: string[], testDir: string, expectSuccess = true) {
    const { stdout, stderr, exited } = spawn({
      cmd,
      cwd: testDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env: bunEnv,
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
      const { output, error, code } = await runCommand([bunExe(), "info"], testDir, false);

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
      const { output, error, code } = await runCommand(
        [bunExe(), "pm", "view", "nonexistent-package-12345"],
        testDir,
        false,
      );

      expect(code).toBe(1);
      expect(error).toContain("Not Found");
      expect(output).toBe("");
    });

    // TODO: Version validation needs to be fixed - currently falls back to first version instead of failing
    it("should handle non-existent version", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number@999.0.0"], testDir, false);

      expect(error).toMatchInlineSnapshot(`
        "error: No version of "is-number" satisfying "999.0.0" found

        Recent versions:
        - 3.0.0
        - 4.0.0
        - 5.0.0
        - 6.0.0
        - 7.0.0
          ... and 10 more
        "
      `);
      expect(code).toBe(1);
    });

    it("should handle non-existent property", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand(
        [bunExe(), "pm", "view", "is-number", "nonexistent"],
        testDir,
        false,
      );

      expect(error).toMatchInlineSnapshot(`
        "error: Property nonexistent not found
        "
      `);
      expect(code).toBe(1);
    });

    it("should handle malformed package specifier", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "@"], testDir, false);

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
      const { output, error, code } = await runCommand([bunExe(), "pm", "view", "."], testDir, false);

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
});

// The version part of `name@spec` resolves like `npm view`: a dist-tag with exactly that name wins, otherwise a
// range picks the best published match. An unknown tag is an error; it is never handed to the range parser
// (which skips unknown words and would match `latest`).
describe.concurrent("bun info version spec", () => {
  const packument = (name: string, tags: Record<string, string>, published: string[]) => ({
    name,
    "dist-tags": tags,
    versions: Object.fromEntries(
      published.map(v => [
        v,
        { name, version: v, dist: { tarball: `http://localhost/${name}/-/${name}-${v}.tgz`, shasum: "0".repeat(40) } },
      ]),
    ),
  });
  const packuments: Record<string, object> = {
    // `v1-lts` (the Angular `vNN-lts` shape) reads as the range `1` to the spec classifier; it is a tag.
    "zz-tags": packument("zz-tags", { latest: "2.0.0", next: "3.0.0", beta: "2.5.0", "v1-lts": "1.0.0" }, [
      "1.0.0",
      "1.5.0",
      "2.0.0",
      "2.5.0",
      "3.0.0",
    ]),
    "zz-case": packument("zz-case", { latest: "1.0.0", Next: "2.0.0" }, ["1.0.0", "2.0.0"]),
    "zz-dangling": packument("zz-dangling", { latest: "9.9.9", "v0-legacy": "0.5.0" }, ["1.0.0"]),
    "zz-onlypre": packument("zz-onlypre", { latest: "1.0.0-beta.2" }, ["1.0.0-beta.1", "1.0.0-beta.2"]),
  };
  let server: ReturnType<typeof Bun.serve>;
  let dir: string;
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const body = packuments[decodeURIComponent(new URL(req.url).pathname).replace(/^\/+|\/+$/g, "")];
        return body ? Response.json(body) : Response.json({ error: "Not found" }, { status: 404 });
      },
    });
    dir = tempDirWithFiles("view-spec", { "package.json": JSON.stringify({ name: "app", version: "0.0.0" }) });
  });
  afterAll(() => server?.stop(true));

  async function info(...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "info", ...args],
      cwd: dir,
      env: { ...bunEnv, BUN_CONFIG_REGISTRY: server.url.origin, NPM_CONFIG_REGISTRY: server.url.origin, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("an unknown dist-tag is an error and lists the tags that exist", async () => {
    for (const args of [
      ["zz-tags@nosuchtag"],
      ["zz-tags@nosuchtag", "version"],
      ["zz-tags@nosuchtag", "dist.tarball"],
    ]) {
      const { stdout, stderr, exitCode } = await info(...args);
      expect(stdout).toBe("");
      expect(stderr).toMatchInlineSnapshot(`
        "error: Package "zz-tags" with tag "nosuchtag" not found, but package exists

        Tags:
        - latest: 2.0.0
        - next: 3.0.0
        - beta: 2.5.0
        - v1-lts: 1.0.0
        "
      `);
      expect(exitCode).toBe(1);
    }
  });

  test("an unknown dist-tag is an error with --json", async () => {
    const { stdout, stderr, exitCode } = await info("zz-tags@nosuchtag", "version", "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ error: "Dist-tag not found", version: "zz-tags@nosuchtag" });
    expect(exitCode).toBe(1);
  });

  test("dist-tags are case-sensitive", async () => {
    const lower = await info("zz-case@next", "version");
    expect(lower.stdout).toBe("");
    expect(lower.stderr).toStartWith(`error: Package "zz-case" with tag "next" not found, but package exists\n`);
    expect(lower.exitCode).toBe(1);
    const exact = await info("zz-case@Next", "version");
    expect(exact.stderr).toBe("");
    expect(exact.stdout).toBe("2.0.0\n");
    expect(exact.exitCode).toBe(0);
  });

  test("a tag that points at an unpublished version is an error", async () => {
    for (const [args, tag] of [
      [["zz-dangling"], "latest"],
      [["zz-dangling@latest"], "latest"],
      [["zz-dangling", "version"], "latest"],
      [["zz-dangling@v0-legacy", "version"], "v0-legacy"],
    ] as const) {
      const { stdout, stderr, exitCode } = await info(...args);
      expect(stdout).toBe("");
      expect(stderr).toStartWith(`error: Package "zz-dangling" with tag "${tag}" not found, but package exists\n`);
      expect(exitCode).toBe(1);
    }
  });

  test("known dist-tags, exact versions and ranges resolve", async () => {
    const resolved: Record<string, string> = {};
    for (const spec of [
      "zz-tags",
      "zz-tags@next",
      "zz-tags@beta",
      "zz-tags@v1-lts",
      "zz-tags@3.0.0",
      "zz-tags@v3.0.0",
      "zz-tags@^1",
      "zz-onlypre",
    ]) {
      const { stdout, stderr, exitCode } = await info(spec, "version");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      resolved[spec] = stdout.trim();
    }
    expect(resolved).toEqual({
      "zz-tags": "2.0.0",
      "zz-tags@next": "3.0.0",
      "zz-tags@beta": "2.5.0",
      // the tag, not the newest `1.x`
      "zz-tags@v1-lts": "1.0.0",
      "zz-tags@3.0.0": "3.0.0",
      "zz-tags@v3.0.0": "3.0.0",
      "zz-tags@^1": "1.5.0",
      "zz-onlypre": "1.0.0-beta.2",
    });
  });

  test("a spec that is neither a tag nor a range matches nothing", async () => {
    for (const spec of ["zz-tags@github:a/b", "zz-tags@npm:other@1.0.0", "zz-tags@1.0.0.tgz"]) {
      const { stdout, stderr, exitCode } = await info(spec, "version");
      expect(stdout).toBe("");
      expect(stderr).toStartWith(
        `error: No version of "zz-tags" satisfying "${spec.slice("zz-tags@".length)}" found\n`,
      );
      expect(exitCode).toBe(1);
    }
  });

  test("`Recent versions:` lists each published version once, newest last", async () => {
    const release = await info("zz-tags@9.9.9", "version");
    expect(release.stdout).toBe("");
    expect(release.stderr).toMatchInlineSnapshot(`
      "error: No version of "zz-tags" satisfying "9.9.9" found

      Recent versions:
      - 1.0.0
      - 1.5.0
      - 2.0.0
      - 2.5.0
      - 3.0.0
      "
    `);
    expect(release.exitCode).toBe(1);
    // Prereleases are listed only when nothing else was ever published.
    const pre = await info("zz-onlypre@9.9.9", "version");
    expect(pre.stdout).toBe("");
    expect(pre.stderr).toMatchInlineSnapshot(`
      "error: No version of "zz-onlypre" satisfying "9.9.9" found

      Recent versions:
      - 1.0.0-beta.1
      - 1.0.0-beta.2
      "
    `);
    expect(pre.exitCode).toBe(1);
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
