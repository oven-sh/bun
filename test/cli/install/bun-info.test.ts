import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDirWithFiles, tmpdirSync } from "harness";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

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

    // Like npm: a field that does not exist prints nothing and is not an error.
    it("should handle non-existent property", async () => {
      const testDir = await setupTest();
      const { output, error, code } = await runCommand(
        [bunExe(), "pm", "view", "is-number", "nonexistent"],
        testDir,
        false,
      );

      expect(error).toBe("");
      expect(output).toBe("");
      expect(code).toBe(0);
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
          "0.0.0",
          "0.0.1-security",
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
        "0.0.0
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

// Everything below runs against an in-process stub registry, so the expected
// output is exact and nothing touches the network.
describe.concurrent("bun pm view (local registry)", () => {
  const tgz = (name: string, v: string) => `http://127.0.0.1/${name}/-/${name}-${v}.tgz`;
  const byPublishOrder = (name: string, order: string[]) =>
    Object.fromEntries(
      order.map(v => [v, { name, version: v, dist: { tarball: tgz(name, v), shasum: "4".repeat(40) } }]),
    );
  const packuments: Record<string, unknown> = {
    "zz-basic": {
      name: "zz-basic",
      description: "basic package",
      homepage: "https://zz.example/home",
      license: "MIT",
      readme: "# the readme",
      readmeFilename: "README.md",
      customRoot: "root-only",
      keywords: ["alpha", "beta"],
      maintainers: [
        { name: "m-one", email: "one@zz.example" },
        { name: "m-two", email: "two@zz.example" },
      ],
      "dist-tags": { latest: "2.0.0", next: "1.0.0" },
      time: {
        created: "2024-01-01T00:00:00.000Z",
        modified: "2024-06-01T12:34:56.789Z",
        "1.0.0": "2024-01-02T00:00:00.000Z",
        "2.0.0": "2024-01-03T00:00:00.000Z",
      },
      versions: {
        "1.0.0": {
          name: "zz-basic",
          version: "1.0.0",
          description: "basic v1",
          license: "MIT",
          dist: { tarball: tgz("zz-basic", "1.0.0"), shasum: "1".repeat(40) },
        },
        "2.0.0": {
          name: "zz-basic",
          version: "2.0.0",
          description: "basic package",
          license: "MIT",
          keywords: ["alpha", "beta"],
          list: ["l0", "l1"],
          flag: false,
          maintainers: [
            { name: "m-one", email: "one@zz.example" },
            { name: "m-two", email: "two@zz.example" },
          ],
          repository: { type: "git", url: "git+https://zz.example/basic.git" },
          exports: { ".": { import: "./i.mjs" }, "./package.json": "./package.json" },
          bin: { zz: "cli.js", yy: "cli2.js" },
          dependencies: { "left-pad": "^1.0.0" },
          // Verdaccio-style packuments keep a readme on each version too.
          readme: "# the version readme",
          dist: { tarball: tgz("zz-basic", "2.0.0"), shasum: "0".repeat(40) },
        },
      },
    },
    // Root fields differ from the only version's fields (a proxy that does not hoist).
    "zz-conflict": {
      name: "zz-conflict",
      description: "ROOT description",
      homepage: "https://zz.example/root-home",
      license: "GPL-3.0",
      keywords: ["rootkw"],
      "dist-tags": { latest: "1.0.0" },
      versions: {
        "1.0.0": {
          name: "zz-conflict",
          version: "1.0.0",
          description: "VERSION description",
          homepage: "https://zz.example/version-home",
          license: "ISC",
          keywords: ["verkw"],
          bin: { conflict: "cli.js" },
          deprecated: "use something else",
          dist: { tarball: tgz("zz-conflict", "1.0.0"), shasum: "2".repeat(40) },
        },
      },
    },
    "zz-nolicense": {
      name: "zz-nolicense",
      "dist-tags": { latest: "1.0.0" },
      versions: byPublishOrder("zz-nolicense", ["1.0.0"]),
    },
    // Published out of semver order (a backport after a major).
    "zz-many": {
      name: "zz-many",
      "dist-tags": { latest: "10.0.0" },
      versions: byPublishOrder("zz-many", ["0.0.0", "1.0.0", "1.0.1", "10.0.0", "2.0.0", "9.0.0", "2.0.0-beta.1"]),
    },
    "zz-pre": {
      name: "zz-pre",
      "dist-tags": { latest: "1.0.0-beta.1" },
      versions: byPublishOrder("zz-pre", ["1.0.0-alpha.1", "1.0.0-alpha.2", "1.0.0-beta.1"]),
    },
    "zz-notags": {
      name: "zz-notags",
      versions: {
        ...byPublishOrder("zz-notags", ["1.0.0"]),
        "1.1.0": {
          name: "zz-notags",
          version: "1.1.0",
          readme: "# only on the version",
          dist: { tarball: tgz("zz-notags", "1.1.0"), shasum: "4".repeat(40) },
        },
      },
    },
  };

  let server: ReturnType<typeof Bun.serve>;
  let registry: string;
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\/|\/$/g, ""));
        if (name === "zz-e500") return new Response("oops", { status: 500 });
        if (name === "zz-malformed")
          return new Response("{not json", { headers: { "content-type": "application/json" } });
        const doc = packuments[name];
        if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
        return Response.json(doc);
      },
    });
    registry = `http://127.0.0.1:${server.port}/`;
  });
  afterAll(() => server.stop(true));

  let dirIndex = 0;
  async function view(args: string[], { cwd, command = ["pm", "view"] }: { cwd?: string; command?: string[] } = {}) {
    cwd ??= tempDirWithFiles("view-local-" + dirIndex++, {
      "package.json": JSON.stringify({ name: "app", version: "0.0.0" }),
    });
    await using proc = spawn({
      cmd: [bunExe(), ...command, ...args],
      cwd,
      env: {
        ...bunEnv,
        BUN_CONFIG_REGISTRY: registry,
        http_proxy: "",
        https_proxy: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
      },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err: err.replaceAll(registry, "http://registry/"), code };
  }

  test("prints every requested field, labelled when there is more than one", async () => {
    expect(await view(["zz-basic", "name", "version"])).toEqual({
      out: `name = "zz-basic"\nversion = "2.0.0"\n`,
      err: "",
      code: 0,
    });
    expect(await view(["zz-basic", "version", "keywords", "repository.url"])).toEqual({
      out: `version = "2.0.0"\nkeywords = ["alpha", "beta"]\nrepository.url = "git+https://zz.example/basic.git"\n`,
      err: "",
      code: 0,
    });
    const json = await view(["zz-basic", "name", "version", "--json"]);
    expect({ ...json, out: JSON.parse(json.out) }).toEqual({
      out: { name: "zz-basic", version: "2.0.0" },
      err: "",
      code: 0,
    });
  });

  test("a field that does not exist is skipped, not an error", async () => {
    // One field left after skipping: printed bare, like a single field.
    expect(await view(["zz-basic", "nonexistent", "version"])).toEqual({ out: "2.0.0\n", err: "", code: 0 });
    expect(await view(["zz-basic", "nonexistent"])).toEqual({ out: "", err: "", code: 0 });
    expect(await view(["zz-basic", "nonexistent", "--json"])).toEqual({ out: "", err: "", code: 0 });
    // `false` is a value, not a missing field.
    expect(await view(["zz-basic", "flag", "--json"])).toEqual({ out: "false\n", err: "", code: 0 });
  });

  test("an index composes with a property: maintainers[0].name", async () => {
    expect(await view(["zz-basic", "maintainers[0].name"])).toEqual({ out: "m-one\n", err: "", code: 0 });
    expect(await view(["zz-basic", "maintainers.1.email"])).toEqual({ out: "two@zz.example\n", err: "", code: 0 });
    expect(await view(["zz-basic", "list.1"])).toEqual({ out: "l1\n", err: "", code: 0 });
    expect(await view(["zz-basic", "list[5]", "maintainers[0].nope"])).toEqual({ out: "", err: "", code: 0 });
  });

  test("a property after an array expands to one result per element", async () => {
    expect(await view(["zz-basic", "maintainers.name"])).toEqual({
      out: `maintainers[0].name = "m-one"\nmaintainers[1].name = "m-two"\n`,
      err: "",
      code: 0,
    });
    const json = await view(["zz-basic", "maintainers.name", "--json"]);
    expect({ ...json, out: JSON.parse(json.out) }).toEqual({
      out: { "maintainers[0].name": "m-one", "maintainers[1].name": "m-two" },
      err: "",
      code: 0,
    });
    // One element: printed bare.
    expect(await view(["zz-conflict", "maintainers.name", "keywords"])).toEqual({
      out: `["verkw"]\n`,
      err: "",
      code: 0,
    });
  });

  test("bracket keys are literal and may contain dots", async () => {
    expect(await view(["zz-basic", "exports[./package.json]"])).toEqual({ out: "./package.json\n", err: "", code: 0 });
    expect(await view(["zz-basic", "exports[.].import"])).toEqual({ out: "./i.mjs\n", err: "", code: 0 });
    expect(await view(["zz-basic", "time[1.0.0]"])).toEqual({ out: "2024-01-02T00:00:00.000Z\n", err: "", code: 0 });
    expect(await view(["zz-basic", "dist-tags.next"])).toEqual({ out: "1.0.0\n", err: "", code: 0 });
    expect(await view(["zz-basic", "list[]"])).toEqual({
      out: "",
      err: "error: Empty brackets are not valid syntax for retrieving values.\n",
      code: 1,
    });
  });

  test("fields resolve against the root merged with the selected version", async () => {
    // Root-only keys are visible, version keys win, `readme` only when asked for.
    expect(await view(["zz-basic@1.0.0", "description", "readmeFilename", "customRoot", "dist-tags.latest"])).toEqual({
      out: `description = "basic v1"\nreadmeFilename = "README.md"\ncustomRoot = "root-only"\ndist-tags.latest = "2.0.0"\n`,
      err: "",
      code: 0,
    });
    // `readme` comes from the root when asked for, from the version when only
    // the version has one, and is left out of everything else.
    expect(await view(["zz-basic", "readme"])).toEqual({ out: "# the readme\n", err: "", code: 0 });
    expect(await view(["zz-notags", "readme"])).toEqual({ out: "# only on the version\n", err: "", code: 0 });
    const bare = await view(["zz-basic", "--json"]);
    expect(JSON.parse(bare.out)).not.toHaveProperty("readme");
    const json = await view(["zz-basic@1.0.0", "--json"]);
    expect(json.err).toBe("");
    // Two-space indentation, root keys first in registry order, then the version's own keys.
    expect(json.out).toStartWith(`{\n  "name": "zz-basic",\n  "description": "basic v1",\n`);
    expect(Object.keys(JSON.parse(json.out))).toEqual([
      "name",
      "description",
      "homepage",
      "license",
      "readmeFilename",
      "customRoot",
      "keywords",
      "maintainers",
      "dist-tags",
      "time",
      "versions",
      "version",
      "dist",
    ]);
    expect(JSON.parse(json.out)).toMatchObject({
      version: "1.0.0",
      versions: ["1.0.0", "2.0.0"],
      "dist-tags": { latest: "2.0.0", next: "1.0.0" },
      time: { "1.0.0": "2024-01-02T00:00:00.000Z" },
    });
    expect(json.code).toBe(0);
  });

  test("the summary describes the selected version, not the packument root", async () => {
    expect(await view(["zz-conflict"])).toEqual({
      out: `zz-conflict@1.0.0 | ISC | deps: 0 | versions: 1
VERSION description
https://zz.example/version-home
keywords: verkw
bin: conflict

DEPRECATED ⚠️  - use something else

dist
 .tarball: http://127.0.0.1/zz-conflict/-/zz-conflict-1.0.0.tgz
 .shasum: ${"2".repeat(40)}

dist-tags:
latest: 1.0.0
`,
      err: "",
      code: 0,
    });
    const v1 = await view(["zz-basic@1.0.0"]);
    expect(v1.out.split("\n").slice(0, 2)).toEqual(["zz-basic@1.0.0 | MIT | deps: 0 | versions: 2", "basic v1"]);
    const nolicense = await view(["zz-nolicense"]);
    expect(nolicense.out.split("\n")[0]).toBe("zz-nolicense@1.0.0 | Proprietary | deps: 0 | versions: 1");
  });

  test("versions are sorted by semver, not publish order", async () => {
    const json = await view(["zz-many", "versions", "--json"]);
    expect({ ...json, out: JSON.parse(json.out) }).toEqual({
      out: ["0.0.0", "1.0.0", "1.0.1", "2.0.0-beta.1", "2.0.0", "9.0.0", "10.0.0"],
      err: "",
      code: 0,
    });
    expect(await view(["zz-many", "versions[6]"])).toEqual({ out: "10.0.0\n", err: "", code: 0 });
    // The hint lists each version once (dist-tag targets used to show up twice).
    expect(await view(["zz-pre@2"])).toEqual({
      out: "",
      err: `error: No version of "zz-pre" satisfying "2" found

Recent versions:
- 1.0.0-alpha.1
- 1.0.0-alpha.2
- 1.0.0-beta.1
`,
      code: 1,
    });
  });

  test("a spec that is neither a dist-tag nor a range matches nothing", async () => {
    expect(await view(["zz-basic@notatag", "version"])).toEqual({
      out: "",
      err: `error: No version of "zz-basic" satisfying "notatag" found

Recent versions:
- 1.0.0
- 2.0.0
`,
      code: 1,
    });
    // A dist-tag that exists still resolves, and `latest` is the default
    // even for a packument that has no dist-tags at all.
    expect(await view(["zz-basic@next", "version"])).toEqual({ out: "1.0.0\n", err: "", code: 0 });
    expect(await view(["zz-notags", "version"])).toEqual({ out: "1.1.0\n", err: "", code: 0 });
  });

  test("--json errors have one shape on stdout", async () => {
    const shape = async (args: string[]) => {
      const { out, err, code } = await view([...args, "--json"]);
      return { out: JSON.parse(out), err, code };
    };
    expect(await shape(["zz-basic@9.9.9"])).toEqual({
      out: {
        error: {
          code: "E404",
          summary: `No version of "zz-basic" satisfying "9.9.9" found`,
          detail: "Recent versions: 1.0.0, 2.0.0",
        },
      },
      err: "",
      code: 1,
    });
    expect(await shape(["zz-basic@notatag", "version"])).toEqual({
      out: {
        error: {
          code: "E404",
          summary: `No version of "zz-basic" satisfying "notatag" found`,
          detail: "Recent versions: 1.0.0, 2.0.0",
        },
      },
      err: "",
      code: 1,
    });
    expect(await shape(["zz-missing"])).toEqual({
      out: {
        error: {
          code: "E404",
          summary: `404 Not Found: ${registry}zz-missing`,
          detail: "'zz-missing@latest' does not exist in this registry",
        },
      },
      err: "",
      code: 1,
    });
    expect(await shape(["zz-e500", "version"])).toEqual({
      out: { error: { code: "E500", summary: `500 Internal Server Error: ${registry}zz-e500`, detail: "" } },
      err: "",
      code: 1,
    });
    expect(await shape(["zz-malformed"])).toEqual({
      out: { error: { code: "EJSONPARSE", summary: "failed to parse response body as JSON", detail: "" } },
      err: "",
      code: 1,
    });
    expect(await shape(["zz-basic", "list[]"])).toEqual({
      out: {
        error: {
          code: "EINVALIDSYNTAX",
          summary: "Empty brackets are not valid syntax for retrieving values.",
          detail: "",
        },
      },
      err: "",
      code: 1,
    });
  });

  test("runs without a package.json", async () => {
    const cwd = tmpdirSync("view-no-project-");
    expect(await view(["zz-basic", "version"], { cwd })).toEqual({ out: "2.0.0\n", err: "", code: 0 });
    expect(await view(["zz-basic", "version"], { cwd, command: ["info"] })).toEqual({
      out: "2.0.0\n",
      err: "",
      code: 0,
    });
    // No spec and nothing to infer it from. Only meaningful when no ancestor of
    // the temp directory happens to have a package.json.
    let hasAncestorPackageJson = false;
    for (let dir = cwd; ; dir = dirname(dir)) {
      if (existsSync(join(dir, "package.json"))) hasAncestorPackageJson = true;
      if (dirname(dir) === dir) break;
    }
    if (!hasAncestorPackageJson) {
      expect(await view([], { cwd, command: ["info"] })).toEqual({
        out: "",
        err: "error: No package name was given and no package.json was found\n",
        code: 1,
      });
    }
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
