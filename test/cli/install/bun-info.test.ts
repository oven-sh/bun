import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir, tempDirWithFiles } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

describe.concurrent("bun info", () => {
  // What registry.npmjs.org serves for these names, cut down to the fields that `bun info` prints or a test reads.
  // The order of fs's `versions`, and fs@0.0.1-security having other maintainers than the package, are the registry's.
  const tarball = (name: string, version: string) =>
    `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;
  const bare = (name: string, versions: string[]) =>
    Object.fromEntries(
      versions.map(version => [version, { name, version, dist: { tarball: tarball(name, version) } }]),
    );
  const isNumber = {
    name: "is-number",
    description:
      "Returns true if a number or string value is a finite number. Useful for regex matches, parsing, user input, etc.",
    homepage: "https://github.com/jonschlinkert/is-number",
    license: "MIT",
    author: { name: "Jon Schlinkert", url: "https://github.com/jonschlinkert" },
    repository: { type: "git", url: "git+https://github.com/jonschlinkert/is-number.git" },
    keywords:
      "cast check coerce coercion finite integer is isnan is-nan is-num is-number isnumber isfinite istype kind math nan num number numeric parseFloat parseInt test type typeof value".split(
        " ",
      ),
    maintainers: [
      { email: "brian.woodward@gmail.com", name: "doowb" },
      { email: "github@sellside.com", name: "jonschlinkert" },
      { email: "me@rouvenwessling.de", name: "realityking" },
    ],
  };
  const fs = {
    name: "fs",
    description:
      "This package name is not currently in use, but was formerly occupied by another package. To avoid malicious use, npm is hanging on to the package name, but loosely, and we'll probably give it to you if you want it.",
    homepage: "https://github.com/npm/security-holder#readme",
    license: "ISC",
    keywords: [],
  };
  const packuments: Record<string, unknown> = {
    "is-number": {
      ...isNumber,
      "dist-tags": { latest: "7.0.0" },
      versions: {
        ...bare(
          "is-number",
          "0.1.0 0.1.1 1.0.0 1.1.0 1.1.1 1.1.2 2.0.0 2.0.1 2.0.2 2.1.0 3.0.0 4.0.0 5.0.0 6.0.0".split(" "),
        ),
        "7.0.0": {
          ...isNumber,
          version: "7.0.0",
          main: "index.js",
          engines: { node: ">=0.12.0" },
          dist: {
            integrity:
              "sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==",
            shasum: "7535345b896734d5f80c4d06c50955527a14f12b",
            tarball: tarball("is-number", "7.0.0"),
            fileCount: 4,
            unpackedSize: 9615,
          },
        },
      },
      time: { "7.0.0": "2018-07-04T15:08:58.238Z" },
    },
    fs: {
      ...fs,
      "dist-tags": { latest: "0.0.1-security" },
      versions: {
        "0.0.1-security": {
          ...fs,
          version: "0.0.1-security",
          dist: {
            shasum: "8a7bd37186b6dddf3813f23858b57ecaaf5e41d4",
            tarball: tarball("fs", "0.0.1-security"),
            integrity:
              "sha512-3XY9e1pP0CVEUCdj5BmfIZxRBTSDycnbqhIOGec9QYtmVH2fbLpj86CFWkrNOkt/Fvty4KZG5lTglL9j/gJ87w==",
          },
          maintainers: [{ name: "ehsalazar", email: "ernie@npmjs.com" }],
        },
        ...bare("fs", ["0.0.0", "0.0.2"]),
      },
      maintainers: [{ name: "npm", email: "npm@npmjs.com" }],
      time: { "0.0.1-security": "2016-08-23T17:56:58.976Z" },
    },
    "@types/bun": { name: "@types/bun", "dist-tags": { latest: "1.3.0" }, versions: bare("@types/bun", ["1.3.0"]) },
    "@types/semver": {
      name: "@types/semver",
      description: "TypeScript definitions for semver",
      "dist-tags": { latest: "7.7.1" },
      versions: bare("@types/semver", ["7.7.1"]),
    },
  };

  let server: ReturnType<typeof Bun.serve>;
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const name = decodeURIComponent(new URL(req.url).pathname.slice(1));
        if (name === "@") {
          return Response.json({ code: "MethodNotAllowedError", message: "GET is not allowed" }, { status: 405 });
        }
        return name in packuments
          ? Response.json(packuments[name])
          : Response.json({ error: "Not found" }, { status: 404 });
      },
    });
  });
  afterAll(() => server.stop(true));

  let i = 0;
  function setupTest() {
    const testDir = tempDirWithFiles("view-" + i++, {
      "package.json": JSON.stringify({
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
      env: { ...bunEnv, BUN_CONFIG_REGISTRY: server.url.href },
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

    it.each([[["info"]], [["pm", "view"]]])("%j asks the registry for a name longer than a path", async command => {
      const { output, error, code } = await runCommand(
        [bunExe(), ...command, Buffer.alloc(5000, "x").toString()],
        await setupTest(),
        false,
      );

      expect(error).toContain("Not Found");
      expect(output).toBe("");
      expect(code).toBe(1);
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

    it("sends Basic <_auth> on the manifest request when only .npmrc _auth is configured", async () => {
      const basic = Buffer.from("alice:hunter2").toString("base64");
      const paths: string[] = [];
      const authorizations: (string | null)[] = [];

      await using registry = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req, server) {
          paths.push(new URL(req.url).pathname);
          authorizations.push(req.headers.get("authorization"));
          return Response.json({
            "name": "pkg",
            "dist-tags": { latest: "1.0.0" },
            "versions": {
              "1.0.0": {
                name: "pkg",
                version: "1.0.0",
                dist: {
                  tarball: `http://127.0.0.1:${server.port}/pkg/-/pkg-1.0.0.tgz`,
                  shasum: "0000000000000000000000000000000000000000",
                },
              },
            },
          });
        },
      });

      const host = `127.0.0.1:${registry.port}`;
      using testDir = tempDir("view-auth", {
        ".npmrc": `registry=http://${host}/\n//${host}/:_auth=${basic}\n`,
        "package.json": JSON.stringify({ name: "probe", version: "0.0.0" }),
        // An empty home: the developer's own `.npmrc` declares a `registry=` that would replace the one under test.
        "home/.gitkeep": "",
      });
      const home = join(String(testDir), "home");

      await using proc = spawn({
        cmd: [bunExe(), "pm", "view", "pkg", "version"],
        cwd: String(testDir),
        env: { ...bunEnv, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, NPM_CONFIG_USERCONFIG: undefined },
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
      });
      const [output, error, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ paths, authorizations, output, error }).toEqual({
        paths: ["/pkg"],
        authorizations: [`Basic ${basic}`],
        output: "1.0.0\n",
        error: "",
      });
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

describe.concurrent("bun info with control characters in the packument", () => {
  // One of each kind of byte the registry must not be able to write to the
  // terminal: ESC (clear screen, then an OSC title change), BEL, a bare CR
  // (overwrites the line), CRLF, tab, DEL, and the C1 controls NEL (U+0085)
  // and CSI (U+009B).
  const hostile = "\x1b[2J\x1b]0;PWNED\x07\rX\r\nY\tZ\x7f\u0085\u009b[31m";
  // The summary view renders every control character as a visible escape.
  const escaped = String.raw`\x1b[2J\x1b]0;PWNED\x07\rX\r\nY\tZ\x7f\u0085\u009b[31m`;
  // `bun pm view <pkg> <field>` keeps CRLF and tab, because the field itself may have several lines (readme), and
  // escapes everything else.
  const escapedMultiline = String.raw`\x1b[2J\x1b]0;PWNED\x07\rX` + "\r\nY\tZ" + String.raw`\x7f\u0085\u009b[31m`;

  const packument = {
    name: "hostile",
    "dist-tags": { latest: "1.0.0", ["tag" + hostile]: "1.0.0" },
    description: "D" + hostile,
    homepage: "H" + hostile,
    keywords: ["K" + hostile, "plain"],
    maintainers: [{ name: "M" + hostile, email: "E" + hostile }, { name: "N" + hostile }],
    time: { "1.0.0": "P" + hostile },
    versions: {
      "1.0.0": {
        name: "n" + hostile,
        version: "1.0.0",
        license: "L" + hostile,
        description: "D" + hostile,
        bin: { ["b" + hostile]: "cli.js" },
        deprecated: "X" + hostile,
        dependencies: { ["dep" + hostile]: "^1" + hostile },
        dist: { tarball: "T" + hostile, shasum: "S" + hostile, integrity: "I" + hostile },
      },
    },
  };

  async function view(...args: string[]) {
    await using server = Bun.serve({
      port: 0,
      fetch: () => Response.json(packument),
    });
    using dir = tempDir("bun-info-control-chars", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0" }),
    });
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: { ...bunEnv, NPM_CONFIG_REGISTRY: server.url.href },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it("escapes every field of the summary view", async () => {
    const { stdout, stderr, exitCode } = await view("info", "hostile");

    // Only the newlines bun itself prints between lines may remain.
    expect(stdout).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f\u0080-\u009f]/);
    expect(stdout.replaceAll(escaped, "<escaped>")).toMatchInlineSnapshot(`
      "n<escaped>@1.0.0 | L<escaped> | deps: 1 | versions: 1
      D<escaped>
      H<escaped>
      keywords: K<escaped>, plain
      bin: b<escaped>

      DEPRECATED ⚠️  - X<escaped>

      dependencies (1):
      - dep<escaped>: ^1<escaped>

      dist
       .tarball: T<escaped>
       .shasum: S<escaped>
       .integrity: I<escaped>

      dist-tags:
      latest: 1.0.0
      tag<escaped>: 1.0.0

      maintainers:
      - M<escaped> <E<escaped>>
      - N<escaped>

      Published: P<escaped>
      "
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("keeps line structure but escapes the rest when printing a single string field", async () => {
    const { stdout, stderr, exitCode } = await view("pm", "view", "hostile", "description");

    expect(stdout).toBe(`D${escapedMultiline}\n`);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it.each([[["description", "license"]], [["dist"]]])("leaves no control character in %j", async fields => {
    const { stdout, stderr, exitCode } = await view("pm", "view", "hostile", ...fields);

    expect(stdout).toContain("PWNED");
    expect(stdout).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f\u0080-\u009f]/);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("escapes the dist-tags listed for an unknown one", async () => {
    const { stdout, stderr, exitCode } = await view("info", "hostile@nosuchtag");

    expect(stdout).toBe("");
    expect(stderr.replaceAll(escaped, "<escaped>")).toBe(
      [
        'error: Package "hostile" with tag "nosuchtag" not found, but package exists',
        "",
        "Tags:",
        "- latest: 1.0.0",
        "- tag<escaped>: 1.0.0",
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(1);
  });
});

// Everything below runs against an in-process stub registry, so the expected
// output is exact and nothing touches the network.
describe.concurrent("bun pm view (local registry)", () => {
  const tgz = (name: string, v: string) => `http://127.0.0.1/${name}/-/${name}-${v}.tgz`;
  const shasum = "0123456789abcdef0123456789abcdef01234567";
  const byPublishOrder = (name: string, order: string[]) =>
    Object.fromEntries(order.map(v => [v, { name, version: v, dist: { tarball: tgz(name, v), shasum } }]));
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
          dist: { tarball: tgz("zz-basic", "1.0.0"), shasum },
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
          dist: { tarball: tgz("zz-basic", "2.0.0"), shasum },
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
          license: { type: "ISC", url: "https://zz.example/license" },
          keywords: ["verkw"],
          bin: { conflict: "cli.js", other: "other.js" },
          deprecated: "use something else",
          dist: { tarball: tgz("zz-conflict", "1.0.0"), shasum },
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
  };

  let server: ReturnType<typeof Bun.serve>;
  let registry: string;
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const doc = packuments[decodeURIComponent(new URL(req.url).pathname.replace(/^\/|\/$/g, ""))];
        return doc ? Response.json(doc) : Response.json({ error: "Not found" }, { status: 404 });
      },
    });
    registry = `http://127.0.0.1:${server.port}/`;
  });
  afterAll(() => server.stop(true));

  async function view(args: string[], { name = "app" as string | null, command = ["pm", "view"] } = {}) {
    using dir = tempDir("view-local", {
      "cwd/.keep": "",
      ...(name === null ? {} : { "cwd/package.json": JSON.stringify({ name }) }),
    });
    await using proc = spawn({
      cmd: [bunExe(), ...command, ...args],
      cwd: join(String(dir), "cwd"),
      env: { ...bunEnv, BUN_CONFIG_REGISTRY: registry },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(readdirSync(join(String(dir), "cwd")).sort()).toEqual(name === null ? [".keep"] : [".keep", "package.json"]);
    return { out, err, code };
  }

  test("prints every requested field, labelled when there is more than one", async () => {
    expect(await view(["zz-basic", "name", "version"])).toEqual({
      out: `name = "zz-basic"\nversion = "2.0.0"\n`,
      err: "",
      code: 0,
    });
    expect(await view(["zz-basic", "version", "keywords", "repository.url", "version"])).toEqual({
      out: `version = "2.0.0"\nkeywords = ["alpha", "beta"]\nrepository.url = "git+https://zz.example/basic.git"\n`,
      err: "",
      code: 0,
    });
    expect(await view(["zz-basic", "name", "version", "--json"])).toEqual({
      out: `{\n  "name": "zz-basic",\n  "version": "2.0.0"\n}\n`,
      err: "",
      code: 0,
    });
    expect(await view(["zz-basic", "--json", "name", "version"], { command: ["info"] })).toEqual({
      out: `{\n  "name": "zz-basic",\n  "version": "2.0.0"\n}\n`,
      err: "",
      code: 0,
    });
  });

  test("a field that does not exist is skipped; it is an error when nothing is left", async () => {
    // One field left after skipping: printed bare, like a single field.
    expect(await view(["zz-basic", "nonexistent", "version"])).toEqual({ out: "2.0.0\n", err: "", code: 0 });
    // `false` is a value, not a missing field.
    expect(await view(["zz-basic", "flag", "--json"])).toEqual({ out: "false\n", err: "", code: 0 });
    expect(await view(["zz-basic", "nonexistent"])).toEqual({
      out: "",
      err: "error: Property nonexistent not found\n",
      code: 1,
    });
    expect(await view(["zz-basic", "list[5]", "maintainers[0].nope"])).toEqual({
      out: "",
      err: "error: Property list[5] not found\nerror: Property maintainers[0].nope not found\n",
      code: 1,
    });
    expect(await view(["zz-basic", "nonexistent", "nope", "--json"])).toEqual({
      out: `{ "error": "Property not found", "version": "zz-basic", "property": "nonexistent" }\n`,
      err: "",
      code: 1,
    });
  });

  test("an index composes with a property: maintainers[0].name", async () => {
    expect(await view(["zz-basic", "maintainers[0].name"])).toEqual({ out: "m-one\n", err: "", code: 0 });
    expect(await view(["zz-basic", "maintainers.1.email"])).toEqual({ out: "two@zz.example\n", err: "", code: 0 });
    expect(await view(["zz-basic", "list.1"])).toEqual({ out: "l1\n", err: "", code: 0 });
  });

  test("a property after an array expands to one result per element", async () => {
    expect(await view(["zz-basic", "maintainers.name"])).toEqual({
      out: `maintainers[0].name = "m-one"\nmaintainers[1].name = "m-two"\n`,
      err: "",
      code: 0,
    });
    expect(await view(["zz-basic", "maintainers.name", "--json"])).toEqual({
      out: `{\n  "maintainers[0].name": "m-one",\n  "maintainers[1].name": "m-two"\n}\n`,
      err: "",
      code: 0,
    });
    // There's nothing to expand and only one field left, so it's printed bare.
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
    expect(await view(["zz-basic", "name", "list[]", "--json"])).toEqual({
      out: `{ "error": "Empty brackets are not valid syntax for retrieving values.", "version": "zz-basic", "property": "list[]" }\n`,
      err: "",
      code: 1,
    });
  });

  test("the selected version also has the registry's package-level fields", async () => {
    // Root-only keys are visible, version keys win, `readme` only when asked for.
    expect(await view(["zz-basic@1.0.0", "description", "readmeFilename", "customRoot", "dist-tags.latest"])).toEqual({
      out: `description = "basic v1"\nreadmeFilename = "README.md"\ncustomRoot = "root-only"\ndist-tags.latest = "2.0.0"\n`,
      err: "",
      code: 0,
    });
    expect(await view(["zz-basic", "readme"])).toEqual({ out: "# the readme\n", err: "", code: 0 });

    const json = await view(["zz-basic@1.0.0", "--json"]);
    expect(json.err).toBe("");
    // Two-space indentation.
    expect(json.out).toStartWith(`{\n  "name": "zz-basic",\n  "version": "1.0.0",\n  "description": "basic v1",\n`);
    expect(JSON.parse(json.out)).toEqual({
      name: "zz-basic",
      version: "1.0.0",
      description: "basic v1",
      license: "MIT",
      dist: { tarball: tgz("zz-basic", "1.0.0"), shasum },
      versions: ["1.0.0", "2.0.0"],
      homepage: "https://zz.example/home",
      readmeFilename: "README.md",
      customRoot: "root-only",
      keywords: ["alpha", "beta"],
      maintainers: (packuments["zz-basic"] as any).maintainers,
      "dist-tags": { latest: "2.0.0", next: "1.0.0" },
      time: (packuments["zz-basic"] as any).time,
    });
    expect(json.code).toBe(0);
  });

  test("the summary describes the selected version, not the packument root", async () => {
    expect(await view(["zz-conflict"])).toEqual({
      out: `zz-conflict@1.0.0 | ISC | deps: 0 | versions: 1
VERSION description
https://zz.example/version-home
keywords: verkw
bin: conflict, other

DEPRECATED ⚠️  - use something else

dist
 .tarball: http://127.0.0.1/zz-conflict/-/zz-conflict-1.0.0.tgz
 .shasum: ${shasum}

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
  });

  test("the --json error objects stay flat", async () => {
    expect(await view(["zz-basic@9.9.9", "--json"])).toEqual({
      out: `{ "error": "No matching version found", "version": "zz-basic@9.9.9" }\n`,
      err: "",
      code: 1,
    });
    expect(await view(["zz-basic@notatag", "version", "--json"])).toEqual({
      out: `{ "error": "Dist-tag not found", "version": "zz-basic@notatag" }\n`,
      err: "",
      code: 1,
    });
  });

  // https://github.com/oven-sh/bun/issues/20673
  test.each([[["pm", "view"]], [["info"]]])("%j runs without a package.json and creates nothing", async command => {
    expect(await view(["zz-basic", "version"], { name: null, command })).toEqual({ out: "2.0.0\n", err: "", code: 0 });
    // No name and nothing to infer it from.
    expect(await view([], { name: null, command })).toEqual({
      out: "",
      err: "error: no package name given and no package.json found\n",
      code: 1,
    });
    expect(await view(["--json"], { name: null, command })).toEqual({
      out: `{ "error": "no package name given and no package.json found", "version": "" }\n`,
      err: "",
      code: 1,
    });
    // With one, it is the package viewed.
    expect(await view([], { name: "zz-nolicense", command })).toMatchObject({
      out: expect.stringMatching(/^zz-nolicense@1\.0\.0 /),
      code: 0,
    });
  });
});

// Semver strings longer than 8 bytes are stored as offsets into the buffer they
// were parsed from. A range given on the command line is parsed from the
// argument, so its prerelease tags have to be read back out of the argument and
// not out of the manifest's string buffer. The manifest buffer starts with the
// package name, and the name is longer than any range below, so reading the
// wrong buffer yields a piece of the name rather than the tag by coincidence.
describe.concurrent("version ranges with prerelease tags longer than 8 bytes", () => {
  const name = "long-prerelease-tags-pkg";
  const published = ["1.0.0-beta.20240101", "1.0.0-beta.20240301"];
  const packument = JSON.stringify({
    name,
    "dist-tags": { latest: "1.0.0-beta.20240301" },
    versions: Object.fromEntries(
      published.map(version => [
        version,
        { name, version, dist: { tarball: `http://localhost/${name}-${version}.tgz` } },
      ]),
    ),
  });

  async function view(subcommand: string[], spec: string) {
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response(packument, { headers: { "content-type": "application/json" } }),
    });
    using dir = tempDir("view-long-prerelease", {
      "package.json": JSON.stringify({ name: "test", version: "1.0.0" }),
      "bunfig.toml": `[install]\nregistry = "http://localhost:${server.port}/"\n`,
    });
    await using proc = spawn({
      cmd: [bunExe(), ...subcommand, `${name}@${spec}`, "version"],
      cwd: String(dir),
      env: { ...bunEnv, http_proxy: "", https_proxy: "", HTTP_PROXY: "", HTTPS_PROXY: "" },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  describe.each([
    ["bun info", ["info"]],
    ["bun pm view", ["pm", "view"]],
  ])("%s", (_, subcommand) => {
    test.each([
      // resolved through the `latest` dist-tag
      [">=1.0.0-beta.20240101", "1.0.0-beta.20240301"],
      ["~1.0.0-beta.20240301", "1.0.0-beta.20240301"],
      // `latest` is excluded, resolved by walking the prerelease list
      ["<1.0.0-beta.20240201", "1.0.0-beta.20240101"],
    ])(`${name}@%s resolves to %s`, async (spec, expected) => {
      expect(await view(subcommand, spec)).toEqual({ stdout: `${expected}\n`, stderr: "", exitCode: 0 });
    });

    test(`${name}@<1.0.0-beta.20240101 matches nothing`, async () => {
      expect(await view(subcommand, "<1.0.0-beta.20240101")).toEqual({
        stdout: "",
        stderr: expect.stringContaining(`No version of "${name}" satisfying "<1.0.0-beta.20240101" found`),
        exitCode: 1,
      });
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
        {
          name,
          version: v,
          dist: { tarball: `http://localhost/${name}/-/${name}-${v}.tgz`, shasum: Buffer.alloc(40, "0").toString() },
        },
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
    "zz-rc": packument("zz-rc", { latest: "2.0.0-rc.1" }, ["1.0.0", "1.1.0", "2.0.0-rc.1"]),
    // Some mirrors and private registries send it like this.
    "zz-untagged": packument("zz-untagged", {}, ["1.0.0", "1.1.0"]),
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

  test.each([[["zz-tags@nosuchtag"]], [["zz-tags@nosuchtag", "version"]], [["zz-tags@nosuchtag", "dist.tarball"]]])(
    "an unknown dist-tag is an error and lists the tags that exist: %p",
    async args => {
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
    },
  );

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

  // Same message as `bun add pkg@<tag>` for this state; the `Tags:` list under it shows where the tag points.
  test.each([
    [["zz-dangling"], "latest"],
    [["zz-dangling@latest"], "latest"],
    [["zz-dangling", "version"], "latest"],
    [["zz-dangling@v0-legacy", "version"], "v0-legacy"],
  ] as const)("a tag that points at an unpublished version is an error: %p", async (args, tag) => {
    const { stdout, stderr, exitCode } = await info(...args);
    expect(stdout).toBe("");
    expect(stderr).toStartWith(`error: Package "zz-dangling" with tag "${tag}" not found, but package exists\n`);
    expect(exitCode).toBe(1);
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

  test.each([
    ["zz-rc@*", "2.0.0-rc.1"],
    ["zz-onlypre@*", "1.0.0-beta.2"],
    ["zz-tags@*", "2.0.0"],
    ["zz-untagged", "1.1.0"],
    ["zz-untagged@latest", "1.1.0"],
    ["zz-untagged@*", "1.1.0"],
  ])("%s is the version that `bun add` installs", async (spec, version) => {
    expect(await info(spec, "version")).toEqual({ stdout: `${version}\n`, stderr: "", exitCode: 0 });
  });

  test.each(["github:a/b", "file:./zz-tags", "npm:other@1.0.0", "1.0.0.tgz"])(
    "a spec that is neither a tag nor a range matches nothing: %s",
    async spec => {
      const { stdout, stderr, exitCode } = await info(`zz-tags@${spec}`, "version");
      expect(stdout).toBe("");
      expect(stderr).toStartWith(`error: No version of "zz-tags" satisfying "${spec}" found\n`);
      expect(exitCode).toBe(1);
    },
  );

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
          dist: { tarball: "http://localhost/leakpkg-0.0.1.tgz", shasum: Buffer.alloc(40, "0").toString() },
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

test("a proxy that refuses CONNECT fails the command with ProxyConnectFailed", async () => {
  using proxy = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket) {
        socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n");
      },
    },
  });
  const dir = tempDirWithFiles("bun-info-proxy-refused", {
    "package.json": JSON.stringify({ name: "test", version: "1.0.0" }),
    "bunfig.toml": Bun.TOML.stringify({ install: { registry: "https://registry.invalid/" } }),
  });
  await using proc = spawn({
    cmd: [bunExe(), "info", "anything"],
    cwd: dir,
    env: {
      ...bunEnv,
      HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
      https_proxy: undefined,
      NO_PROXY: undefined,
      no_proxy: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("ProxyConnectFailed");
  expect(exitCode).toBe(1);
});

describe.concurrent("a registry response whose matched `versions` entry is not an object", () => {
  const entries = { number: 5, string: "x", null: null, array: [] };

  async function run(entry: keyof typeof entries, args: string[]) {
    const manifest = JSON.stringify({
      name: "pkg",
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": entries[entry] },
    });
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response(manifest, { headers: { "content-type": "application/json" } }),
    });
    using dir = tempDir("bun-info-version-entry", {
      "package.json": JSON.stringify({ name: "test", version: "1.0.0" }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: server.url.href } }),
    });
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const rejected = {
    stdout: "",
    stderr: 'error: failed to parse package manifest: version "1.0.0" is not an object\n',
    exitCode: 1,
  };

  for (const entry of Object.keys(entries) as (keyof typeof entries)[]) {
    test(`bun info: ${entry}`, async () => {
      expect(await run(entry, ["info", "pkg"])).toEqual(rejected);
    });
  }

  test("bun pm view --json", async () => {
    expect(await run("number", ["pm", "view", "pkg", "--json"])).toEqual(rejected);
  });

  test("bun pm view <property>", async () => {
    expect(await run("number", ["pm", "view", "pkg@1.0.0", "name"])).toEqual(rejected);
  });
});
