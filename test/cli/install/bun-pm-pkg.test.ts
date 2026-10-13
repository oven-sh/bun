import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

async function runPmPkg(args: string[], cwd: string, expectSuccess = true) {
  await using proc = spawn({
    cmd: [bunExe(), "pm", "pkg", ...args],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (expectSuccess && exitCode !== 0) {
    throw new Error(`Expected success but got code ${exitCode}. stderr: ${stderr}`);
  }

  return { output: stdout, error: stderr, code: exitCode };
}

const readPkg = (dir: string) => Bun.file(join(dir, "package.json")).json();

function createTestPackageJson(overrides = {}) {
  return JSON.stringify(
    {
      name: "test-package",
      version: "1.0.0",
      description: "A test package",
      main: "index.js",
      scripts: {
        test: "echo 'test'",
        build: "echo 'build'",
      },
      keywords: ["test", "package"],
      author: "Test Author",
      license: "MIT",
      dependencies: {
        "lodash": "^4.17.21",
        "react": "^18.0.0",
      },
      devDependencies: {
        "typescript": "^5.0.0",
        "@types/node": "^20.0.0",
      },
      engines: {
        node: ">=18",
      },
      bin: {
        "test-cli": "./bin/cli.js",
      },
      contributors: [
        {
          name: "John Doe",
          email: "john@example.com",
        },
        {
          name: "Jane Smith",
        },
      ],
      private: false,
      testBoolean: true,
      testNumber: 42,
      testFloat: 3.14,
      testNull: null,
      ...overrides,
    },
    null,
    2,
  );
}

const makeTestDir = () => tempDir("pm-pkg-test", { "package.json": createTestPackageJson() });

describe.concurrent("bun pm pkg", () => {
  // Shared fixture for read-only `get` tests. Tests that write create their own tempDir.
  let readonlyDir: string;
  beforeAll(() => {
    readonlyDir = String(tempDir("pm-pkg-readonly", { "package.json": createTestPackageJson() }));
  });
  afterAll(() => {
    rmSync(readonlyDir, { recursive: true, force: true });
  });

  describe("get command", () => {
    it("should get a single property", async () => {
      const { output, error, code } = await runPmPkg(["get", "name"], readonlyDir);
      expect(output.trim()).toBe('"test-package"');
      expect(error).toBe("");
      expect(code).toBe(0);
    });

    it("should get multiple properties", async () => {
      const { output, code } = await runPmPkg(["get", "name", "version"], readonlyDir);
      expect(JSON.parse(output)).toEqual({ name: "test-package", version: "1.0.0" });
      expect(code).toBe(0);
    });

    it("should get entire package.json when no args provided", async () => {
      const { output, code } = await runPmPkg(["get"], readonlyDir);
      expect(JSON.parse(output)).toMatchObject({
        name: "test-package",
        version: "1.0.0",
        description: "A test package",
      });
      expect(code).toBe(0);
    });

    it("should get nested properties with dot notation", async () => {
      const { output, code } = await runPmPkg(["get", "scripts.test"], readonlyDir);
      expect(output.trim()).toBe("\"echo 'test'\"");
      expect(code).toBe(0);
    });

    it("should get array elements with bracket notation", async () => {
      const { output, code } = await runPmPkg(["get", "contributors[0].name"], readonlyDir);
      expect(output.trim()).toBe('"John Doe"');
      expect(code).toBe(0);
    });

    it("should get object properties with bracket notation", async () => {
      const { output, code } = await runPmPkg(["get", "scripts[test]"], readonlyDir);
      expect(output.trim()).toBe("\"echo 'test'\"");
      expect(code).toBe(0);
    });

    it("should get array elements with dot notation (npm compatibility)", async () => {
      const { output, code } = await runPmPkg(["get", "contributors.0.name"], readonlyDir);
      expect(output.trim()).toBe('"John Doe"');
      expect(code).toBe(0);
    });

    it("should get array elements with dot numeric index", async () => {
      const { output, code } = await runPmPkg(["get", "keywords.0"], readonlyDir);
      expect(output.trim()).toBe('"test"');
      expect(code).toBe(0);
    });

    it("should get array elements without index (entire array)", async () => {
      const { output, code } = await runPmPkg(["get", "contributors"], readonlyDir);
      expect(JSON.parse(output)).toEqual([{ name: "John Doe", email: "john@example.com" }, { name: "Jane Smith" }]);
      expect(code).toBe(0);
    });

    it("should handle missing properties gracefully", async () => {
      const { output, code } = await runPmPkg(["get", "nonexistent"], readonlyDir);
      expect(output.trim()).toBe("{}");
      expect(code).toBe(0);
    });

    it("should handle mixed existing and missing properties", async () => {
      const { output, code } = await runPmPkg(["get", "name", "nonexistent", "version"], readonlyDir);
      expect(JSON.parse(output)).toEqual({ name: "test-package", version: "1.0.0" });
      expect(code).toBe(0);
    });

    it("should handle boolean values", async () => {
      const { output, code } = await runPmPkg(["get", "testBoolean"], readonlyDir);
      expect(output.trim()).toBe("true");
      expect(code).toBe(0);
    });

    it("should handle number values", async () => {
      const { output, code } = await runPmPkg(["get", "testNumber"], readonlyDir);
      expect(output.trim()).toBe("42");
      expect(code).toBe(0);
    });

    it("should handle null values", async () => {
      const { output, code } = await runPmPkg(["get", "testNull"], readonlyDir);
      expect(output.trim()).toBe("null");
      expect(code).toBe(0);
    });

    it("should handle numeric property names on objects", async () => {
      using dir = makeTestDir();
      const { code: setCode } = await runPmPkg(["set", "config.123=test-value"], dir);
      expect(setCode).toBe(0);

      const { output, code } = await runPmPkg(["get", "config.123"], dir);
      expect(output.trim()).toBe('"test-value"');
      expect(code).toBe(0);
    });

    it("should fail gracefully when no package.json found", async () => {
      using emptyDir = tempDir("pm-pkg-empty", {});
      const { error, code } = await runPmPkg(["get", "name"], emptyDir, false);
      expect(error).toContain("No package.json was found");
      expect(code).toBe(1);
    });
  });

  describe("set command", () => {
    it("should set a simple string property", async () => {
      using dir = makeTestDir();
      const { error, code } = await runPmPkg(["set", "description=New description"], dir);
      expect(error).toBe("");
      expect(code).toBe(0);
      expect((await readPkg(dir)).description).toBe("New description");
    });

    it("should set multiple properties", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["set", "version=2.0.0", "description=Updated"], dir);
      expect(code).toBe(0);
      expect(await readPkg(dir)).toMatchObject({ version: "2.0.0", description: "Updated" });
    });

    it("should set nested properties with dot notation", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["set", "scripts.newScript=echo hello"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir)).scripts.newScript).toBe("echo hello");
    });

    it("should create nested objects when they don't exist", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["set", "config.debug=true"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir)).config).toEqual({ debug: "true" });
    });

    it("should handle JSON boolean true with --json flag", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["set", "private=true", "--json"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir)).private).toBe(true);
    });

    it("should handle JSON boolean false with --json flag", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["set", "testBool=false", "--json"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir)).testBool).toBe(false);
    });

    it("should handle JSON null with --json flag", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["set", "testNull=null", "--json"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir)).testNull).toBeNull();
    });

    it("should handle JSON integers with --json flag", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["set", "testInt=42", "--json"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir)).testInt).toBe(42);
    });

    it("should handle JSON floats with --json flag", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["set", "testFloat=3.14", "--json"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir)).testFloat).toBe(3.14);
    });

    it("should handle JSON objects with --json flag", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["set", 'newObject={"key":"value","number":123}', "--json"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir)).newObject).toEqual({ key: "value", number: 123 });
    });

    it("should handle JSON arrays with --json flag", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["set", 'newArray=["one","two","three"]', "--json"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir)).newArray).toEqual(["one", "two", "three"]);
    });

    it("should treat values as strings without --json flag", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(
        ["set", "stringTrue=true", "stringFalse=false", "stringNull=null", "stringNumber=42"],
        dir,
      );
      expect(code).toBe(0);
      expect(await readPkg(dir)).toMatchObject({
        stringTrue: "true",
        stringFalse: "false",
        stringNull: "null",
        stringNumber: "42",
      });
    });

    it("should preserve file formatting", async () => {
      using dir = makeTestDir();
      await runPmPkg(["set", "version=1.0.1"], dir);

      const modifiedContent = await Bun.file(join(dir, "package.json")).text();
      expect(modifiedContent).toContain('  "version": "1.0.1"');
      expect(JSON.parse(modifiedContent).version).toBe("1.0.1");
    });

    it("should write integers as plain digits, never in exponent notation", async () => {
      // The JS printer shortens 10000 to 1e4. JSON.stringify never does that
      // for integers below 1e21, and neither should package.json.
      const original = {
        name: "test-package",
        version: "1.0.0",
        port: 10000,
        timeout: 1000,
        big: 160000,
        negative: -100000,
        float: 1.5,
        list: [10000, 1000000000, 123456789],
      };
      using dir = tempDir("pm-pkg-integers", {
        "package.json": JSON.stringify(original, null, 2),
      });

      const { error, code } = await runPmPkg(["set", "config.limit=1000000", "--json"], dir);
      expect(error).toBe("");
      expect(code).toBe(0);

      const content = await Bun.file(join(dir, "package.json")).text();
      expect(content).toContain('"port": 10000');
      expect(content).toContain('"timeout": 1000');
      expect(content).toContain('"big": 160000');
      expect(content).toContain('"negative": -100000');
      expect(content).toContain('"limit": 1000000');
      expect(content).toMatch(/\[\s*10000,\s*1000000000,\s*123456789\s*\]/);
      expect(content).not.toMatch(/\d[eE][-+]?\d/);
      expect(JSON.parse(content)).toEqual({ ...original, config: { limit: 1000000 } });
    });

    it("should write literal keys when setting with bracket notation", async () => {
      // Key-path segments parsed from a bracket path must stay alive until
      // the file is written; otherwise the printer serializes freed bytes.
      using dir = tempDir("pm-pkg-bracket-set", {
        "package.json": JSON.stringify({ name: "x", version: "1.0.0" }, null, 2),
      });

      const { code } = await runPmPkg(
        ["set", "contributors[0]=alice", "nested.deep[0]=value", "scripts[lint]=eslint ."],
        dir,
      );
      expect(code).toBe(0);

      expect(await readPkg(dir)).toEqual({
        name: "x",
        version: "1.0.0",
        contributors: { "0": "alice" },
        nested: { deep: { "0": "value" } },
        scripts: { lint: "eslint ." },
      });
    });

    it("should fail with invalid key=value format", async () => {
      using dir = makeTestDir();
      const { error, code } = await runPmPkg(["set", "invalidformat"], dir, false);
      expect(error).toContain("Invalid argument");
      expect(code).toBe(1);
    });

    it("should fail with empty key", async () => {
      using dir = makeTestDir();
      const { error, code } = await runPmPkg(["set", "=value"], dir, false);
      expect(error).toContain("Empty key");
      expect(code).toBe(1);
    });

    it("should fail when no arguments provided", async () => {
      using dir = makeTestDir();
      const { error, code } = await runPmPkg(["set"], dir, false);
      expect(error).toContain("set expects a key=value pair");
      expect(code).toBe(1);
    });
  });

  describe("delete command", () => {
    it("should delete a property", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["delete", "description"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir)).description).toBeUndefined();
    });

    it("should delete nested properties", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["delete", "scripts.test"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir)).scripts).toEqual({ build: "echo 'build'" });
    });

    it("should handle deleting non-existent properties", async () => {
      using dir = makeTestDir();
      const before = await readPkg(dir);
      const { code } = await runPmPkg(["delete", "nonexistent"], dir);
      expect(code).toBe(0);
      expect(await readPkg(dir)).toEqual(before);
    });

    it("should delete multiple properties", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["delete", "keywords", "author", "license"], dir);
      expect(code).toBe(0);
      const pkg = await readPkg(dir);
      expect(pkg.keywords).toBeUndefined();
      expect(pkg.author).toBeUndefined();
      expect(pkg.license).toBeUndefined();
    });

    it("should fail when no arguments provided", async () => {
      using dir = makeTestDir();
      const { error, code } = await runPmPkg(["delete"], dir, false);
      expect(error).toContain("delete expects key args");
      expect(code).toBe(1);
    });
  });

  describe("help command", () => {
    it("should show help", async () => {
      const { output, code } = await runPmPkg(["help"], readonlyDir);
      expect(output).toContain("bun pm pkg");
      expect(output).toContain("get");
      expect(output).toContain("set");
      expect(output).toContain("delete");
      expect(output).toContain("fix");
      expect(code).toBe(0);
    });

    it("should show help when no subcommand provided", async () => {
      const { output, code } = await runPmPkg([], readonlyDir);
      expect(output).toContain("bun pm pkg");
      expect(code).toBe(0);
    });

    it("should show help for unknown subcommand", async () => {
      const { output, error, code } = await runPmPkg(["unknown"], readonlyDir, false);
      expect(error).toContain("Unknown subcommand");
      expect(output).toContain("bun pm pkg");
      expect(code).toBe(1);
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle malformed JSON gracefully", async () => {
      using dir = tempDir("pm-pkg-malformed", { "package.json": '{ "name": "test", invalid }' });
      const { error, code } = await runPmPkg(["get", "name"], dir, false);
      expect(error).toContain("Failed to parse package.json");
      expect(code).toBe(1);
    });

    it("should handle non-object root gracefully", async () => {
      using dir = tempDir("pm-pkg-nonobject", { "package.json": '["not", "an", "object"]' });
      const { error, code } = await runPmPkg(["get", "name"], dir, false);
      expect(error).toContain("package.json root must be an object");
      expect(code).toBe(1);
    });

    it("should handle very deeply nested properties", async () => {
      using dir = makeTestDir();
      const { code } = await runPmPkg(["set", "very.deeply.nested.property=value"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir)).very).toEqual({ deeply: { nested: { property: "value" } } });
    });

    it("should maintain npm pkg compatibility", async () => {
      using dir = makeTestDir();
      const { error, code } = await runPmPkg(["set", "emptyString="], dir, false);
      expect(error).toContain("Empty value");
      expect(code).toBe(1);
    });
  });

  describe("workspace compatibility", () => {
    it("should work in workspace root", async () => {
      using workspaceDir = tempDir("pm-pkg-workspace", {
        "package.json": JSON.stringify({
          name: "workspace-root",
          version: "1.0.0",
          workspaces: ["packages/*"],
        }),
        "packages/pkg-a/package.json": JSON.stringify({
          name: "@workspace/pkg-a",
          version: "1.0.0",
        }),
      });

      const { output, code } = await runPmPkg(["get", "name"], workspaceDir);
      expect(output.trim()).toBe('"workspace-root"');
      expect(code).toBe(0);
    });

    it("should work in workspace package directory", async () => {
      using workspaceDir = tempDir("pm-pkg-workspace", {
        "package.json": JSON.stringify({
          name: "workspace-root",
          workspaces: ["packages/*"],
        }),
        "packages/pkg-a/package.json": JSON.stringify({
          name: "@workspace/pkg-a",
          version: "1.0.0",
        }),
      });

      const pkgDir = join(workspaceDir, "packages", "pkg-a");
      const { output, code } = await runPmPkg(["get", "name"], pkgDir);
      expect(output.trim()).toBe('"@workspace/pkg-a"');
      expect(code).toBe(0);
    });

    it("should modify workspace package.json without affecting root", async () => {
      using workspaceDir = tempDir("pm-pkg-workspace", {
        "package.json": JSON.stringify({
          name: "workspace-root",
          version: "1.0.0",
          description: "Root package",
          workspaces: ["packages/*"],
        }),
        "packages/pkg-a/package.json": JSON.stringify({
          name: "@workspace/pkg-a",
          version: "1.0.0",
          description: "Package A",
        }),
      });

      const pkgDir = join(workspaceDir, "packages", "pkg-a");
      const { code } = await runPmPkg(["set", "description=Updated Package A"], pkgDir);
      expect(code).toBe(0);

      expect((await readPkg(pkgDir)).description).toBe("Updated Package A");
      expect((await readPkg(workspaceDir)).description).toBe("Root package");
    });

    it("should modify root without affecting workspace packages", async () => {
      using workspaceDir = tempDir("pm-pkg-workspace", {
        "package.json": JSON.stringify({
          name: "workspace-root",
          version: "1.0.0",
          workspaces: ["packages/*"],
        }),
        "packages/pkg-a/package.json": JSON.stringify({
          name: "@workspace/pkg-a",
          version: "1.0.0",
        }),
        "packages/pkg-b/package.json": JSON.stringify({
          name: "@workspace/pkg-b",
          version: "2.0.0",
        }),
      });

      const { code } = await runPmPkg(["set", "version=1.0.1"], workspaceDir);
      expect(code).toBe(0);

      expect((await readPkg(workspaceDir)).version).toBe("1.0.1");
      expect((await readPkg(join(workspaceDir, "packages", "pkg-a"))).version).toBe("1.0.0");
      expect((await readPkg(join(workspaceDir, "packages", "pkg-b"))).version).toBe("2.0.0");
    });
  });

  describe("deeply nested directory scenarios", () => {
    it("should find package.json in deeply nested directories", async () => {
      using dir = tempDir("pm-pkg-nested", {
        "package.json": JSON.stringify({ name: "root-package", version: "1.0.0" }, null, 2),
      });

      const deepPath = join(dir, "src", "components", "ui", "buttons", "primary");
      mkdirSync(deepPath, { recursive: true });

      const { output, code } = await runPmPkg(["get", "name"], deepPath);
      expect(output.trim()).toBe('"root-package"');
      expect(code).toBe(0);
    });

    it("should find nearest package.json in nested structure", async () => {
      using dir = tempDir("pm-pkg-nested", {
        "package.json": JSON.stringify({ name: "root-package", version: "1.0.0" }, null, 2),
      });

      const uiDir = join(dir, "packages", "ui");
      mkdirSync(uiDir, { recursive: true });
      writeFileSync(join(uiDir, "package.json"), JSON.stringify({ name: "ui-package", version: "2.0.0" }, null, 2));

      const deepDir = join(uiDir, "src", "components");
      mkdirSync(deepDir, { recursive: true });

      const [root, ui, deep] = await Promise.all([
        runPmPkg(["get", "name"], dir, false),
        runPmPkg(["get", "name"], uiDir, false),
        runPmPkg(["get", "name"], deepDir, false),
      ]);

      expect(root.output.trim()).toBe('"root-package"');
      expect(root.code).toBe(0);
      expect(ui.output.trim()).toBe('"ui-package"');
      expect(ui.code).toBe(0);
      expect(deep.output.trim()).toBe('"ui-package"');
      expect(deep.code).toBe(0);
    });

    it("should handle modifications from deeply nested directories", async () => {
      using dir = tempDir("pm-pkg-nested", {
        "package.json": JSON.stringify({ name: "my-project", version: "1.0.0", scripts: { test: "jest" } }, null, 2),
      });

      const deepDir = join(dir, "src", "utils", "helpers", "string");
      mkdirSync(deepDir, { recursive: true });

      const { code: setCode } = await runPmPkg(["set", "scripts.build=webpack"], deepDir);
      expect(setCode).toBe(0);

      expect((await readPkg(dir)).scripts).toEqual({ test: "jest", build: "webpack" });
    });
  });

  describe("npm pkg compatibility tests", () => {
    it("should handle all data types correctly", async () => {
      const testCases = [
        ["testBoolean", "true"],
        ["testNumber", "42"],
        ["testFloat", "3.14"],
        ["testNull", "null"],
        ["name", '"test-package"'],
      ] as const;

      const results = await Promise.all(testCases.map(([key]) => runPmPkg(["get", key], readonlyDir)));
      for (const [i, [, expected]] of testCases.entries()) {
        expect(results[i].output.trim()).toBe(expected);
        expect(results[i].code).toBe(0);
      }
    });

    it("should handle complex nested structures", async () => {
      const [scripts, contrib] = await Promise.all([
        runPmPkg(["get", "scripts"], readonlyDir),
        runPmPkg(["get", "contributors[0]"], readonlyDir),
      ]);

      expect(JSON.parse(scripts.output)).toEqual({ test: "echo 'test'", build: "echo 'build'" });
      expect(scripts.code).toBe(0);

      expect(JSON.parse(contrib.output)).toEqual({ name: "John Doe", email: "john@example.com" });
      expect(contrib.code).toBe(0);
    });

    it("should produce equivalent output to npm pkg for common operations", async () => {
      const [single, multi, missing] = await Promise.all([
        runPmPkg(["get", "name"], readonlyDir),
        runPmPkg(["get", "name", "version"], readonlyDir),
        runPmPkg(["get", "nonexistent"], readonlyDir),
      ]);

      expect(single.output.trim()).toBe('"test-package"');
      expect(JSON.parse(multi.output)).toEqual({ name: "test-package", version: "1.0.0" });
      expect(missing.output.trim()).toBe("{}");
    });
  });

  describe("comprehensive notation compatibility tests", () => {
    it("should handle mixed bracket and dot notation equivalently", async () => {
      const [bracket, dot] = await Promise.all([
        runPmPkg(["get", "contributors[0].name"], readonlyDir),
        runPmPkg(["get", "contributors.0.name"], readonlyDir),
      ]);
      expect(bracket.output.trim()).toBe('"John Doe"');
      expect(dot.output.trim()).toBe('"John Doe"');
    });

    it("should handle complex mixed notation patterns", async () => {
      using dir = makeTestDir();
      const { code: setCode } = await runPmPkg(
        ["set", 'nested.array=[{"prop":"value1"},{"prop":"value2"}]', "--json"],
        dir,
      );
      expect(setCode).toBe(0);

      const testCases = [
        "nested.array.0.prop",
        "nested.array[0].prop",
        "nested[array][0][prop]",
        "nested[array].0.prop",
      ];
      const results = await Promise.all(testCases.map(n => runPmPkg(["get", n], dir, false)));
      for (const [i, notation] of testCases.entries()) {
        expect({ notation, output: results[i].output.trim() }).toEqual({ notation, output: '"value1"' });
        expect(results[i].code).toBe(0);
      }
    });

    it("should handle string properties in bracket notation", async () => {
      const testCases = [
        ["scripts[test]", "\"echo 'test'\""],
        ["scripts[build]", "\"echo 'build'\""],
        ["engines[node]", '">=18"'],
        ["bin[test-cli]", '"./bin/cli.js"'],
      ] as const;
      const results = await Promise.all(testCases.map(([n]) => runPmPkg(["get", n], readonlyDir)));
      for (const [i, [notation, expected]] of testCases.entries()) {
        expect({ notation, output: results[i].output.trim() }).toEqual({ notation, output: expected });
        expect(results[i].code).toBe(0);
      }
    });

    it("should handle numeric indices with different data types", async () => {
      using dir = makeTestDir();

      const [arr0, arr1] = await Promise.all([
        runPmPkg(["get", "keywords.0"], dir, false),
        runPmPkg(["get", "keywords.1"], dir, false),
      ]);
      expect(arr0.output.trim()).toBe('"test"');
      expect(arr0.code).toBe(0);
      expect(arr1.output.trim()).toBe('"package"');
      expect(arr1.code).toBe(0);

      const { code: setCode } = await runPmPkg(["set", "config.0=zero-value"], dir);
      expect(setCode).toBe(0);

      const { output } = await runPmPkg(["get", "config.0"], dir);
      expect(output.trim()).toBe('"zero-value"');
    });

    it("should gracefully handle invalid notation patterns", async () => {
      const invalidCases = ["contributors.999", "scripts[nonexistent]", "keywords.abc", "nonexistent.0"];
      const results = await Promise.all(invalidCases.map(n => runPmPkg(["get", n], readonlyDir)));
      for (const [i, notation] of invalidCases.entries()) {
        expect({ notation, output: results[i].output.trim() }).toEqual({ notation, output: "{}" });
        expect(results[i].code).toBe(0);
      }
    });

    it("should reject empty bracket notation for get operations (npm compatibility)", async () => {
      const invalidCases = ["contributors[]", "contributors[].name", "scripts[]"];
      const results = await Promise.all(invalidCases.map(n => runPmPkg(["get", n], readonlyDir, false)));
      for (const [i, notation] of invalidCases.entries()) {
        expect(results[i].error).toContain("Empty brackets are not valid syntax for retrieving values");
        expect({ notation, code: results[i].code }).toEqual({ notation, code: 1 });
      }
    });

    it("should maintain consistency between set and get operations", async () => {
      using dir = makeTestDir();

      const { code: setCode1 } = await runPmPkg(["set", "test.array.0=first"], dir);
      expect(setCode1).toBe(0);
      const { output: getOutput1 } = await runPmPkg(["get", "test.array.0"], dir);
      expect(getOutput1.trim()).toBe('"first"');

      const { code: setCode2 } = await runPmPkg(["set", "test.bracket.access=success"], dir);
      expect(setCode2).toBe(0);
      const { output: getOutput2 } = await runPmPkg(["get", "test.bracket.access"], dir);
      expect(getOutput2.trim()).toBe('"success"');
    });

    it("should handle edge cases with special characters", async () => {
      using dir = makeTestDir();

      const { code: setCode } = await runPmPkg(["set", "special-key=hyphen-value"], dir);
      expect(setCode).toBe(0);
      expect((await readPkg(dir))["special-key"]).toBe("hyphen-value");

      const { output } = await runPmPkg(["get", "contributors[0][name]"], dir);
      expect(output.trim()).toBe('"John Doe"');
    });

    it("should verify npm compatibility with real-world patterns", async () => {
      using realWorldDir = tempDir("pm-pkg-real-world", {
        "package.json": JSON.stringify(
          {
            name: "my-project",
            version: "1.0.0",
            scripts: {
              "test": "jest",
              "test:watch": "jest --watch",
              "build": "webpack",
              "build:prod": "webpack --mode=production",
            },
            dependencies: {
              "react": "^18.0.0",
              "@types/node": "^20.0.0",
            },
            workspaces: ["packages/*", "apps/*"],
            publishConfig: {
              registry: "https://npm.pkg.github.com",
            },
          },
          null,
          2,
        ),
      });

      const testCases = [
        ["scripts[test]", '"jest"'],
        ["scripts[test:watch]", '"jest --watch"'],
        ["workspaces.0", '"packages/*"'],
        ["workspaces[1]", '"apps/*"'],
        ["dependencies[react]", '"^18.0.0"'],
        ["dependencies[@types/node]", '"^20.0.0"'],
        ["publishConfig[registry]", '"https://npm.pkg.github.com"'],
      ] as const;
      const results = await Promise.all(testCases.map(([n]) => runPmPkg(["get", n], realWorldDir, false)));
      for (const [i, [notation, expected]] of testCases.entries()) {
        expect({ notation, output: results[i].output.trim() }).toEqual({ notation, output: expected });
        expect(results[i].code).toBe(0);
      }
    });
  });

  describe("fix command", () => {
    const makeFixDir = () =>
      tempDir("pm-pkg-fix", {
        "package.json": JSON.stringify(
          {
            name: "TEST-PACKAGE",
            version: "1.0.0",
            description: "Test package",
            main: "index.js",
            bin: {
              "mycli": "./bin/nonexistent.js",
              "othercli": "./bin/also-missing.js",
            },
            dependencies: {
              "react": "^18.0.0",
            },
          },
          null,
          2,
        ),
      });

    it("should fix uppercase package names to lowercase", async () => {
      using dir = makeFixDir();
      const { code } = await runPmPkg(["fix"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir)).name).toBe("test-package");
    });

    it("should warn about missing bin files", async () => {
      using dir = makeFixDir();
      const { error, code } = await runPmPkg(["fix"], dir);
      expect(error).toContain("No bin file found at ./bin/nonexistent.js");
      expect(error).toContain("No bin file found at ./bin/also-missing.js");
      expect(code).toBe(0);
    });

    it("should not modify package.json if no fixes are needed", async () => {
      using goodDir = tempDir("pm-pkg-good", {
        "package.json": JSON.stringify(
          { name: "good-package", version: "1.0.0", description: "Already good package" },
          null,
          2,
        ),
      });

      const beforeContent = await Bun.file(join(goodDir, "package.json")).text();
      const { code } = await runPmPkg(["fix"], goodDir);
      expect(code).toBe(0);
      expect(await Bun.file(join(goodDir, "package.json")).text()).toBe(beforeContent);
    });

    it("should handle package.json with existing bin files", async () => {
      using binDir = tempDir("pm-pkg-bin", {
        "package.json": JSON.stringify(
          { name: "BIN-PACKAGE", version: "1.0.0", bin: { "actualcli": "./bin/real.js" } },
          null,
          2,
        ),
        "bin/real.js": "#!/usr/bin/env node\nconsole.log('Hello');",
      });

      const { error, code } = await runPmPkg(["fix"], binDir);
      expect(error).not.toContain("No bin file found at ./bin/real.js");
      expect(code).toBe(0);
      expect((await readPkg(binDir)).name).toBe("bin-package");
    });

    it("should preserve all other package.json fields", async () => {
      using dir = makeFixDir();
      const { code } = await runPmPkg(["fix"], dir);
      expect(code).toBe(0);

      expect(await readPkg(dir)).toMatchObject({
        name: "test-package",
        version: "1.0.0",
        description: "Test package",
        dependencies: { react: "^18.0.0" },
        bin: { mycli: "./bin/nonexistent.js" },
      });
    });

    it("should handle malformed package.json gracefully", async () => {
      using malformedDir = tempDir("pm-pkg-malformed-fix", { "package.json": '{"name": "test", invalid}' });
      const { error, code } = await runPmPkg(["fix"], malformedDir, false);
      expect(error).toContain("package.json");
      expect(code).toBe(1);
    });

    it("should handle non-object package.json", async () => {
      using nonObjectDir = tempDir("pm-pkg-nonobject-fix", { "package.json": '"this is not an object"' });
      const { error, code } = await runPmPkg(["fix"], nonObjectDir, false);
      expect(error).toContain("package.json root must be an object");
      expect(code).toBe(1);
    });

    it("should fix multiple issues in one run", async () => {
      using multiIssueDir = tempDir("pm-pkg-multi-issue", {
        "package.json": JSON.stringify(
          {
            name: "MULTIPLE-ISSUES-PACKAGE",
            version: "1.0.0",
            bin: { "missing1": "./nonexistent1.js", "missing2": "./nonexistent2.js" },
          },
          null,
          2,
        ),
      });

      const { error, code } = await runPmPkg(["fix"], multiIssueDir);
      expect(error).toContain("No bin file found at ./nonexistent1.js");
      expect(error).toContain("No bin file found at ./nonexistent2.js");
      expect(code).toBe(0);
      expect((await readPkg(multiIssueDir)).name).toBe("multiple-issues-package");
    });

    it("should not crash on empty bin object", async () => {
      using emptyBinDir = tempDir("pm-pkg-empty-bin", {
        "package.json": JSON.stringify({ name: "EMPTY-BIN-PACKAGE", version: "1.0.0", bin: {} }, null, 2),
      });

      const { error, code } = await runPmPkg(["fix"], emptyBinDir);
      expect(error).toBe("");
      expect(code).toBe(0);
      expect((await readPkg(emptyBinDir)).name).toBe("empty-bin-package");
    });

    it("should handle missing package.json file", async () => {
      using emptyDir = tempDir("pm-pkg-empty", {});
      const { error, code } = await runPmPkg(["fix"], emptyDir, false);
      expect(error).toContain("package.json");
      expect(code).toBe(1);
    });
  });

  // npm does the actual "" key, but bun right now doesn't support it
  describe.todo("empty string key compatibility", () => {
    const makeEmptyKeyDir = () =>
      tempDir("pm-pkg-empty-key", {
        "package.json": JSON.stringify({ name: "test-package", version: "1.0.0", "": "empty-key-value" }, null, 2),
      });

    it("should get empty string property key (npm compatibility)", async () => {
      using dir = makeEmptyKeyDir();
      const { output, code } = await runPmPkg(["get", ""], dir);
      expect(output.trim()).toBe('"empty-key-value"');
      expect(code).toBe(0);
    });

    it("should set empty string property key", async () => {
      using dir = makeEmptyKeyDir();
      const { code } = await runPmPkg(["set", "=new-empty-value"], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir))[""]).toBe("new-empty-value");
    });

    it.todo("should delete empty string property key", async () => {
      using dir = makeEmptyKeyDir();
      const { code } = await runPmPkg(["delete", ""], dir);
      expect(code).toBe(0);
      expect((await readPkg(dir))[""]).toBeUndefined();
    });
  });
});
