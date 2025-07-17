import { spawn } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

async function runPmPkg(args: string[], cwd: string, expectSuccess = true) {
  await using proc = spawn({
    cmd: [bunExe(), "pm", "pkg", ...args],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

  const exitCode = await proc.exited;

  if (expectSuccess && exitCode !== 0) {
    throw new Error(`Expected success but got code ${exitCode}. stderr: ${stderr}`);
  }

  return { output: stdout, error: stderr, code: exitCode };
}

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
      testNull: null,
      ...overrides,
    },
    null,
    2,
  );
}

describe("bun pm pkg", () => {
  let testDir: string | undefined;

  beforeEach(() => {
    testDir = tempDirWithFiles("pm-pkg-test", {
      "package.json": createTestPackageJson(),
    });
  });

  afterEach(() => {
    if (testDir!) {
      rmSync(testDir!, { recursive: true, force: true });
    }
  });

  describe("get command", () => {
    it("should get a single property", async () => {
      const { output, code } = await runPmPkg(["get", "name"], testDir!);
      expect(code).toBe(0);
      expect(output.trim()).toBe('"test-package"');
    });

    it("should get multiple properties", async () => {
      const { output, code } = await runPmPkg(["get", "name", "version"], testDir!);
      expect(code).toBe(0);

      expect(output).toContain('"name":');
      expect(output).toContain('"version":');
      expect(output).toContain("test-package");
      expect(output).toContain("1.0.0");
    });

    it("should get entire package.json when no args provided", async () => {
      const { output, code } = await runPmPkg(["get"], testDir!);
      expect(code).toBe(0);

      const parsed = JSON.parse(output);
      expect(parsed.name).toBe("test-package");
      expect(parsed.version).toBe("1.0.0");
      expect(parsed.description).toBe("A test package");
    });

    it("should get nested properties with dot notation", async () => {
      const { output, code } = await runPmPkg(["get", "scripts.test"], testDir!);
      expect(code).toBe(0);
      expect(output.trim()).toBe("\"echo 'test'\"");
    });

    it("should get array elements with bracket notation", async () => {
      const { output, code } = await runPmPkg(["get", "contributors[0].name"], testDir!);
      expect(code).toBe(0);
      expect(output.trim()).toBe('"John Doe"');
    });

    it("should get object properties with bracket notation", async () => {
      const { output, code } = await runPmPkg(["get", "scripts[test]"], testDir!);
      expect(code).toBe(0);
      expect(output.trim()).toBe("\"echo 'test'\"");
    });

    it("should get array elements with dot notation (npm compatibility)", async () => {
      const { output, code } = await runPmPkg(["get", "contributors.0.name"], testDir!);
      expect(code).toBe(0);
      expect(output.trim()).toBe('"John Doe"');
    });

    it("should get array elements with dot numeric index", async () => {
      const { output, code } = await runPmPkg(["get", "keywords.0"], testDir!);
      expect(code).toBe(0);
      expect(output.trim()).toBe('"test"');
    });

    it("should get array elements without index (entire array)", async () => {
      const { output, code } = await runPmPkg(["get", "contributors"], testDir!);
      expect(code).toBe(0);

      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe("John Doe");
    });

    it("should handle missing properties gracefully", async () => {
      const { output, code } = await runPmPkg(["get", "nonexistent"], testDir!);
      expect(code).toBe(0);
      expect(output.trim()).toBe("{}");
    });

    it("should handle mixed existing and missing properties", async () => {
      const { output, code } = await runPmPkg(["get", "name", "nonexistent", "version"], testDir!);
      expect(code).toBe(0);

      expect(output).toContain('"name":');
      expect(output).toContain('"version":');
      expect(output).toContain("test-package");
      expect(output).toContain("1.0.0");
    });

    it("should handle boolean values", async () => {
      const { output, code } = await runPmPkg(["get", "testBoolean"], testDir!);
      expect(code).toBe(0);
      expect(output.trim()).toBe("true");
    });

    it("should handle number values", async () => {
      const { output, code } = await runPmPkg(["get", "testNumber"], testDir!);
      expect(code).toBe(0);
      expect(output.trim()).toBe("42");
    });

    it("should handle null values", async () => {
      const { output, code } = await runPmPkg(["get", "testNull"], testDir!);
      expect(code).toBe(0);
      expect(output.trim()).toBe("null");
    });

    it("should handle numeric property names on objects", async () => {
      // First set a numeric property name
      const { code: setCode } = await runPmPkg(["set", "config.123=test-value"], testDir!);
      expect(setCode).toBe(0);

      // Then retrieve it using dot notation
      const { output, code } = await runPmPkg(["get", "config.123"], testDir!);
      expect(code).toBe(0);
      expect(output.trim()).toBe('"test-value"');
    });

    it("should fail gracefully when no package.json found", async () => {
      const emptyDir = tempDirWithFiles("empty-test", {});

      const { error, code } = await runPmPkg(["get", "name"], emptyDir, false);
      expect(code).toBe(1);
      expect(error).toContain("No package.json was found");

      rmSync(emptyDir, { recursive: true, force: true });
    });
  });

  describe("set command", () => {
    it("should set a simple string property", async () => {
      const { code } = await runPmPkg(["set", "description=New description"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "description"], testDir!);
      expect(getOutput.trim()).toBe('"New description"');
    });

    it("should set multiple properties", async () => {
      const { code } = await runPmPkg(["set", "version=2.0.0", "description=Updated"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "version", "description"], testDir!);
      expect(getOutput).toContain('"version": "2.0.0"');
      expect(getOutput).toContain('"description": "Updated"');
    });

    it("should set nested properties with dot notation", async () => {
      const { code } = await runPmPkg(["set", "scripts.newScript=echo hello"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "scripts.newScript"], testDir!);
      expect(getOutput.trim()).toBe('"echo hello"');
    });

    it("should create nested objects when they don't exist", async () => {
      const { code } = await runPmPkg(["set", "config.debug=true"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "config"], testDir!);
      const parsed = JSON.parse(getOutput);
      expect(parsed.debug).toBe("true");
    });

    it("should handle JSON boolean true with --json flag", async () => {
      const { code } = await runPmPkg(["set", "private=true", "--json"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "private"], testDir!);
      expect(getOutput.trim()).toBe("true");
    });

    it("should handle JSON boolean false with --json flag", async () => {
      const { code } = await runPmPkg(["set", "testBool=false", "--json"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "testBool"], testDir!);
      expect(getOutput.trim()).toBe("false");
    });

    it("should handle JSON null with --json flag", async () => {
      const { code } = await runPmPkg(["set", "testNull=null", "--json"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "testNull"], testDir!);
      expect(getOutput.trim()).toBe("null");
    });

    it("should handle JSON integers with --json flag", async () => {
      const { code } = await runPmPkg(["set", "testInt=42", "--json"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "testInt"], testDir!);
      expect(getOutput.trim()).toBe("42");
    });

    it("should handle JSON floats with --json flag", async () => {
      const { code } = await runPmPkg(["set", "testFloat=3.14", "--json"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "testFloat"], testDir!);
      expect(getOutput.trim()).toBe("3.14");
    });

    it("should handle JSON objects with --json flag", async () => {
      const { code } = await runPmPkg(["set", 'newObject={"key":"value","number":123}', "--json"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "newObject"], testDir!);
      const parsed = JSON.parse(getOutput);
      expect(parsed.key).toBe("value");
      expect(parsed.number).toBe(123);
    });

    it("should handle JSON arrays with --json flag", async () => {
      const { code } = await runPmPkg(["set", 'newArray=["one","two","three"]', "--json"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "newArray"], testDir!);
      const parsed = JSON.parse(getOutput);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toEqual(["one", "two", "three"]);
    });

    it("should treat values as strings without --json flag", async () => {
      const { code } = await runPmPkg(
        ["set", "stringTrue=true", "stringFalse=false", "stringNull=null", "stringNumber=42"],
        testDir!,
      );
      expect(code).toBe(0);

      const { output: getTrue } = await runPmPkg(["get", "stringTrue"], testDir!);
      expect(getTrue.trim()).toBe('"true"');

      const { output: getFalse } = await runPmPkg(["get", "stringFalse"], testDir!);
      expect(getFalse.trim()).toBe('"false"');

      const { output: getNull } = await runPmPkg(["get", "stringNull"], testDir!);
      expect(getNull.trim()).toBe('"null"');

      const { output: getNumber } = await runPmPkg(["get", "stringNumber"], testDir!);
      expect(getNumber.trim()).toBe('"42"');
    });

    it("should preserve file formatting", async () => {
      await runPmPkg(["set", "version=1.0.1"], testDir!);

      const modifiedContent = await Bun.file(join(testDir!, "package.json")).text();

      expect(modifiedContent).toContain('  "version": "1.0.1"');

      expect(() => JSON.parse(modifiedContent)).not.toThrow();
    });

    it("should fail with invalid key=value format", async () => {
      const { error, code } = await runPmPkg(["set", "invalidformat"], testDir!, false);
      expect(code).toBe(1);
      expect(error).toContain("Invalid argument");
    });

    it("should fail with empty key", async () => {
      const { error, code } = await runPmPkg(["set", "=value"], testDir!, false);
      expect(code).toBe(1);
      expect(error).toContain("Empty key");
    });

    it("should fail when no arguments provided", async () => {
      const { error, code } = await runPmPkg(["set"], testDir!, false);
      expect(code).toBe(1);
      expect(error).toContain("set expects a key=value pair");
    });
  });

  describe("delete command", () => {
    it("should delete a property", async () => {
      const { code } = await runPmPkg(["delete", "description"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "description"], testDir!);
      expect(getOutput.trim()).toBe("{}");
    });

    it("should delete nested properties", async () => {
      const { code } = await runPmPkg(["delete", "scripts.test"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "scripts.test"], testDir!);
      expect(getOutput.trim()).toBe("{}");

      const { output: scriptsOutput } = await runPmPkg(["get", "scripts"], testDir!);
      const scripts = JSON.parse(scriptsOutput);
      expect(scripts.build).toBe("echo 'build'");
      expect(scripts.test).toBeUndefined();
    });

    it("should handle deleting non-existent properties", async () => {
      const { code } = await runPmPkg(["delete", "nonexistent"], testDir!);
      expect(code).toBe(0);
    });

    it("should delete multiple properties", async () => {
      const { code } = await runPmPkg(["delete", "keywords", "author", "license"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "keywords", "author", "license"], testDir!);
      expect(getOutput.trim()).toBe("{}");
    });

    it("should fail when no arguments provided", async () => {
      const { error, code } = await runPmPkg(["delete"], testDir!, false);
      expect(code).toBe(1);
      expect(error).toContain("delete expects key args");
    });
  });

  describe("help command", () => {
    it("should show help", async () => {
      const { output, code } = await runPmPkg(["help"], testDir!);
      expect(code).toBe(0);
      expect(output).toContain("bun pm pkg");
      expect(output).toContain("get");
      expect(output).toContain("set");
      expect(output).toContain("delete");
      expect(output).toContain("fix");
    });

    it("should show help when no subcommand provided", async () => {
      const { output, code } = await runPmPkg([], testDir!);
      expect(code).toBe(0);
      expect(output).toContain("bun pm pkg");
    });

    it("should show help for unknown subcommand", async () => {
      const { output, error, code } = await runPmPkg(["unknown"], testDir!, false);
      expect(code).toBe(1);
      expect(error).toContain("Unknown subcommand");
      expect(output).toContain("bun pm pkg");
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle malformed JSON gracefully", async () => {
      writeFileSync(join(testDir!, "package.json"), '{ "name": "test", invalid }');

      const { error, code } = await runPmPkg(["get", "name"], testDir!, false);
      expect(code).toBe(1);
      expect(error).toContain("Failed to parse package.json");
    });

    it("should handle non-object root gracefully", async () => {
      writeFileSync(join(testDir!, "package.json"), '["not", "an", "object"]');

      const { error, code } = await runPmPkg(["get", "name"], testDir!, false);
      expect(code).toBe(1);
      expect(error).toContain("package.json root must be an object");
    });

    it("should handle very deeply nested properties", async () => {
      const { code } = await runPmPkg(["set", "very.deeply.nested.property=value"], testDir!);
      expect(code).toBe(0);

      const { output: getOutput } = await runPmPkg(["get", "very.deeply.nested.property"], testDir!);
      expect(getOutput.trim()).toBe('"value"');
    });

    it("should maintain npm pkg compatibility", async () => {
      const { error, code } = await runPmPkg(["set", "emptyString="], testDir!, false);
      expect(code).toBe(1);
      expect(error).toContain("Empty value");
    });
  });

  describe("workspace compatibility", () => {
    it("should work in workspace root", async () => {
      const workspaceDir = tempDirWithFiles("workspace-test", {
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
      expect(code).toBe(0);
      expect(output.trim()).toBe('"workspace-root"');

      rmSync(workspaceDir, { recursive: true, force: true });
    });

    it("should work in workspace package directory", async () => {
      const workspaceDir = tempDirWithFiles("workspace-test", {
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
      expect(code).toBe(0);
      expect(output.trim()).toBe('"@workspace/pkg-a"');

      rmSync(workspaceDir, { recursive: true, force: true });
    });

    it("should modify workspace package.json without affecting root", async () => {
      const workspaceDir = tempDirWithFiles("workspace-test", {
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

      const { output: pkgOutput } = await runPmPkg(["get", "description"], pkgDir);
      expect(pkgOutput.trim()).toBe('"Updated Package A"');

      const { output: rootOutput } = await runPmPkg(["get", "description"], workspaceDir);
      expect(rootOutput.trim()).toBe('"Root package"');

      rmSync(workspaceDir, { recursive: true, force: true });
    });

    it("should modify root without affecting workspace packages", async () => {
      const workspaceDir = tempDirWithFiles("workspace-test", {
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

      const { output: rootOutput } = await runPmPkg(["get", "version"], workspaceDir);
      expect(rootOutput.trim()).toBe('"1.0.1"');

      const pkgADir = join(workspaceDir, "packages", "pkg-a");
      const { output: pkgAOutput } = await runPmPkg(["get", "version"], pkgADir);
      expect(pkgAOutput.trim()).toBe('"1.0.0"');

      const pkgBDir = join(workspaceDir, "packages", "pkg-b");
      const { output: pkgBOutput } = await runPmPkg(["get", "version"], pkgBDir);
      expect(pkgBOutput.trim()).toBe('"2.0.0"');

      rmSync(workspaceDir, { recursive: true, force: true });
    });
  });

  describe("deeply nested directory scenarios", () => {
    let nestedDir: string;

    afterEach(() => {
      if (nestedDir) {
        rmSync(nestedDir, { recursive: true, force: true });
      }
    });

    it("should find package.json in deeply nested directories", async () => {
      nestedDir = tempDirWithFiles("nested-test", {
        "package.json": JSON.stringify(
          {
            name: "root-package",
            version: "1.0.0",
          },
          null,
          2,
        ),
      });

      const deepPath = join(nestedDir, "src", "components", "ui", "buttons", "primary");
      mkdirSync(deepPath, { recursive: true });

      const { output, code } = await runPmPkg(["get", "name"], deepPath);
      expect(code).toBe(0);
      expect(output.trim()).toBe('"root-package"');
    });

    it("should find nearest package.json in nested structure", async () => {
      nestedDir = tempDirWithFiles("nested-test", {
        "package.json": JSON.stringify(
          {
            name: "root-package",
            version: "1.0.0",
          },
          null,
          2,
        ),
      });

      const uiDir = join(nestedDir, "packages", "ui");
      mkdirSync(uiDir, { recursive: true });
      writeFileSync(
        join(uiDir, "package.json"),
        JSON.stringify(
          {
            name: "ui-package",
            version: "2.0.0",
          },
          null,
          2,
        ),
      );

      const deepDir = join(uiDir, "src", "components");
      mkdirSync(deepDir, { recursive: true });

      const { output: rootOutput, code: rootCode } = await runPmPkg(["get", "name"], nestedDir);
      expect(rootCode).toBe(0);
      expect(rootOutput.trim()).toBe('"root-package"');

      const { output: uiOutput, code: uiCode } = await runPmPkg(["get", "name"], uiDir);
      expect(uiCode).toBe(0);
      expect(uiOutput.trim()).toBe('"ui-package"');

      const { output: deepOutput, code: deepCode } = await runPmPkg(["get", "name"], deepDir);
      expect(deepCode).toBe(0);
      expect(deepOutput.trim()).toBe('"ui-package"');
    });

    it("should handle modifications from deeply nested directories", async () => {
      nestedDir = tempDirWithFiles("nested-test", {
        "package.json": JSON.stringify(
          {
            name: "my-project",
            version: "1.0.0",
            scripts: {
              test: "jest",
            },
          },
          null,
          2,
        ),
      });

      const deepDir = join(nestedDir, "src", "utils", "helpers", "string");
      mkdirSync(deepDir, { recursive: true });

      const { code: setCode } = await runPmPkg(["set", "scripts.build=webpack"], deepDir);
      expect(setCode).toBe(0);

      const { output: deepOutput } = await runPmPkg(["get", "scripts.build"], deepDir);
      expect(deepOutput.trim()).toBe('"webpack"');

      const { output: rootOutput } = await runPmPkg(["get", "scripts.build"], nestedDir);
      expect(rootOutput.trim()).toBe('"webpack"');

      const pkgContent = await Bun.file(join(nestedDir, "package.json")).json();
      expect(pkgContent.scripts.build).toBe("webpack");
    });
  });

  describe("npm pkg compatibility tests", () => {
    it("should handle all data types correctly", async () => {
      const testCases = [
        ["testBoolean", "true"],
        ["testNumber", "42"],
        ["testNull", "null"],
        ["name", '"test-package"'],
      ];

      for (const [key, expected] of testCases) {
        const { output: testOutput, code: testCode } = await runPmPkg(["get", key.toString()], testDir!);
        expect(testCode).toBe(0);

        if (typeof expected === "string") {
          expect(testOutput.trim()).toBe(expected);
        } else {
          expect(testOutput.trim()).toMatch(expected);
        }
      }
    });

    it("should handle complex nested structures", async () => {
      const { output: scriptsOutput, code: scriptsCode } = await runPmPkg(["get", "scripts"], testDir!);
      expect(scriptsCode).toBe(0);

      const scripts = JSON.parse(scriptsOutput);
      expect(scripts.test).toBe("echo 'test'");
      expect(scripts.build).toBe("echo 'build'");

      const { output: contribOutput, code: contribCode } = await runPmPkg(["get", "contributors[0]"], testDir!);
      expect(contribCode).toBe(0);

      const firstContrib = JSON.parse(contribOutput);
      expect(firstContrib.name).toBe("John Doe");
      expect(firstContrib.email).toBe("john@example.com");
    });

    it("should produce equivalent output to npm pkg for common operations", async () => {
      const { output: nameOutput } = await runPmPkg(["get", "name"], testDir!);
      expect(nameOutput.trim()).toBe('"test-package"');

      const { output: multiOutput } = await runPmPkg(["get", "name", "version"], testDir!);
      expect(multiOutput).toContain('"name":');
      expect(multiOutput).toContain('"version":');

      const { output: missingOutput } = await runPmPkg(["get", "nonexistent"], testDir!);
      expect(missingOutput.trim()).toBe("{}");
    });
  });

  describe("comprehensive notation compatibility tests", () => {
    it("should handle mixed bracket and dot notation equivalently", async () => {
      // Test that bracket[0] and dot.0 notation produce identical results
      const { output: bracketOutput } = await runPmPkg(["get", "contributors[0].name"], testDir!);
      const { output: dotOutput } = await runPmPkg(["get", "contributors.0.name"], testDir!);

      expect(bracketOutput.trim()).toBe(dotOutput.trim());
      expect(bracketOutput.trim()).toBe('"John Doe"');
    });

    it("should handle complex mixed notation patterns", async () => {
      // Set up a complex nested structure for testing
      const { code: setCode } = await runPmPkg(
        ["set", 'nested.array=[{"prop":"value1"},{"prop":"value2"}]', "--json"],
        testDir!,
      );
      expect(setCode).toBe(0);

      // Test various notation combinations
      const testCases = [
        "nested.array.0.prop", // dot.dot.dot
        "nested.array[0].prop", // dot.bracket.dot
        "nested[array][0][prop]", // bracket.bracket.bracket
        "nested[array].0.prop", // bracket.dot.dot
      ];

      for (const notation of testCases) {
        const { output, code } = await runPmPkg(["get", notation], testDir!);
        expect(code).toBe(0);
        expect(output.trim()).toBe('"value1"');
      }
    });

    it("should handle string properties in bracket notation", async () => {
      // Test various string property access patterns
      const testCases = [
        ["scripts[test]", "\"echo 'test'\""],
        ["scripts[build]", "\"echo 'build'\""],
        ["engines[node]", '">=18"'],
        ["bin[test-cli]", '"./bin/cli.js"'],
      ];

      for (const [notation, expected] of testCases) {
        const { output, code } = await runPmPkg(["get", notation], testDir!);
        expect(code).toBe(0);
        expect(output.trim()).toBe(expected);
      }
    });

    it("should handle numeric indices with different data types", async () => {
      // Test numeric access on arrays vs objects
      const { output: arrayAccess } = await runPmPkg(["get", "keywords.0"], testDir!);
      expect(arrayAccess.trim()).toBe('"test"');

      const { output: arrayAccess2 } = await runPmPkg(["get", "keywords.1"], testDir!);
      expect(arrayAccess2.trim()).toBe('"package"');

      // Test numeric property on object (not array)
      const { code: setCode } = await runPmPkg(["set", "config.0=zero-value"], testDir!);
      expect(setCode).toBe(0);

      const { output: objectNumericAccess } = await runPmPkg(["get", "config.0"], testDir!);
      expect(objectNumericAccess.trim()).toBe('"zero-value"');
    });

    it("should gracefully handle invalid notation patterns", async () => {
      const invalidCases = [
        "contributors.999", // Out of bounds array index
        "scripts[nonexistent]", // Non-existent property
        "keywords.abc", // Non-numeric on array
        "nonexistent.0", // Non-existent parent
      ];

      for (const notation of invalidCases) {
        const { output, code } = await runPmPkg(["get", notation], testDir!);
        expect(code).toBe(0);
        expect(output.trim()).toBe("{}");
      }
    });

    it("should reject empty bracket notation for get operations (npm compatibility)", async () => {
      // Empty brackets are not valid for retrieving values, only for setting
      const invalidEmptyBracketCases = ["contributors[]", "contributors[].name", "scripts[]"];

      for (const notation of invalidEmptyBracketCases) {
        const { error, code } = await runPmPkg(["get", notation], testDir!, false);
        expect(code).toBe(1);
        expect(error).toContain("Empty brackets are not valid syntax for retrieving values");
      }
    });

    it("should maintain consistency between set and get operations", async () => {
      // Set using dot notation with numeric property, get using same dot notation
      const { code: setCode1 } = await runPmPkg(["set", "test.array.0=first"], testDir!);
      expect(setCode1).toBe(0);

      const { output: getOutput1 } = await runPmPkg(["get", "test.array.0"], testDir!);
      expect(getOutput1.trim()).toBe('"first"');

      // Set using dot notation, get using dot notation
      const { code: setCode2 } = await runPmPkg(["set", "test.bracket.access=success"], testDir!);
      expect(setCode2).toBe(0);

      const { output: getOutput2 } = await runPmPkg(["get", "test.bracket.access"], testDir!);
      expect(getOutput2.trim()).toBe('"success"');
    });

    it("should handle edge cases with special characters", async () => {
      // Test properties with hyphens, dots, and other special chars
      const { code: setCode1 } = await runPmPkg(["set", "special-key=hyphen-value"], testDir!);
      expect(setCode1).toBe(0);

      const { output: getOutput1 } = await runPmPkg(["get", "special-key"], testDir!);
      expect(getOutput1.trim()).toBe('"hyphen-value"');

      // Test bracket notation with special characters
      const { output: getOutput2 } = await runPmPkg(["get", "contributors[0][name]"], testDir!);
      expect(getOutput2.trim()).toBe('"John Doe"');
    });

    it("should verify npm compatibility with real-world patterns", async () => {
      // Create a package.json structure similar to real projects
      const realWorldDir = tempDirWithFiles("real-world-test", {
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

      try {
        // Test common real-world access patterns
        const testCases = [
          ["scripts[test]", '"jest"'],
          ["scripts[test:watch]", '"jest --watch"'],
          ["workspaces.0", '"packages/*"'],
          ["workspaces[1]", '"apps/*"'],
          ["dependencies[react]", '"^18.0.0"'],
          ["dependencies[@types/node]", '"^20.0.0"'],
          ["publishConfig[registry]", '"https://npm.pkg.github.com"'],
        ];

        for (const [notation, expected] of testCases) {
          const { output, code } = await runPmPkg(["get", notation], realWorldDir);
          expect(code).toBe(0);
          expect(output.trim()).toBe(expected);
        }
      } finally {
        rmSync(realWorldDir, { recursive: true, force: true });
      }
    });
  });

  describe("fix command", () => {
    let fixTestDir: string;

    beforeEach(() => {
      fixTestDir = tempDirWithFiles("fix-test", {
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
    });

    afterEach(() => {
      if (fixTestDir) {
        rmSync(fixTestDir, { recursive: true, force: true });
      }
    });

    it("should fix uppercase package names to lowercase", async () => {
      const { code } = await runPmPkg(["fix"], fixTestDir);
      expect(code).toBe(0);

      const { output: nameOutput } = await runPmPkg(["get", "name"], fixTestDir);
      expect(nameOutput.trim()).toBe('"test-package"');
    });

    it("should warn about missing bin files", async () => {
      const { code, error } = await runPmPkg(["fix"], fixTestDir);
      expect(code).toBe(0);
      expect(error).toContain("No bin file found at ./bin/nonexistent.js");
      expect(error).toContain("No bin file found at ./bin/also-missing.js");
    });

    it("should not modify package.json if no fixes are needed", async () => {
      // First, create a package.json that doesn't need fixing
      const goodDir = tempDirWithFiles("good-package", {
        "package.json": JSON.stringify(
          {
            name: "good-package",
            version: "1.0.0",
            description: "Already good package",
          },
          null,
          2,
        ),
      });

      try {
        const beforeContent = await Bun.file(join(goodDir, "package.json")).text();
        const { code } = await runPmPkg(["fix"], goodDir);
        expect(code).toBe(0);

        const afterContent = await Bun.file(join(goodDir, "package.json")).text();
        expect(afterContent).toBe(beforeContent);
      } finally {
        rmSync(goodDir, { recursive: true, force: true });
      }
    });

    it("should handle package.json with existing bin files", async () => {
      // Create a package with an actual bin file
      const binDir = tempDirWithFiles("bin-test", {
        "package.json": JSON.stringify(
          {
            name: "BIN-PACKAGE",
            version: "1.0.0",
            bin: {
              "actualcli": "./bin/real.js",
            },
          },
          null,
          2,
        ),
        "bin/real.js": "#!/usr/bin/env node\nconsole.log('Hello');",
      });

      try {
        const { code, error } = await runPmPkg(["fix"], binDir);
        expect(code).toBe(0);
        // Should not warn about the real file
        expect(error).not.toContain("No bin file found at ./bin/real.js");

        // Should still fix the name
        const { output: nameOutput } = await runPmPkg(["get", "name"], binDir);
        expect(nameOutput.trim()).toBe('"bin-package"');
      } finally {
        rmSync(binDir, { recursive: true, force: true });
      }
    });

    it("should preserve all other package.json fields", async () => {
      const { code } = await runPmPkg(["fix"], fixTestDir);
      expect(code).toBe(0);

      // Verify all other fields are preserved
      const { output: versionOutput } = await runPmPkg(["get", "version"], fixTestDir);
      expect(versionOutput.trim()).toBe('"1.0.0"');

      const { output: descOutput } = await runPmPkg(["get", "description"], fixTestDir);
      expect(descOutput.trim()).toBe('"Test package"');

      const { output: depsOutput } = await runPmPkg(["get", "dependencies.react"], fixTestDir);
      expect(depsOutput.trim()).toBe('"^18.0.0"');

      const { output: binOutput } = await runPmPkg(["get", "bin.mycli"], fixTestDir);
      expect(binOutput.trim()).toBe('"./bin/nonexistent.js"');
    });

    it("should handle malformed package.json gracefully", async () => {
      const malformedDir = tempDirWithFiles("malformed-test", {
        "package.json": '{"name": "test", invalid}',
      });

      try {
        const { code, error } = await runPmPkg(["fix"], malformedDir, false);
        expect(code).toBe(1);
        expect(error).toContain("package.json");
      } finally {
        rmSync(malformedDir, { recursive: true, force: true });
      }
    });

    it("should handle non-object package.json", async () => {
      const nonObjectDir = tempDirWithFiles("non-object-test", {
        "package.json": '"this is not an object"',
      });

      try {
        const { code, error } = await runPmPkg(["fix"], nonObjectDir, false);
        expect(code).toBe(1);
        expect(error).toContain("package.json root must be an object");
      } finally {
        rmSync(nonObjectDir, { recursive: true, force: true });
      }
    });

    it("should fix multiple issues in one run", async () => {
      const multiIssueDir = tempDirWithFiles("multi-issue-test", {
        "package.json": JSON.stringify(
          {
            name: "MULTIPLE-ISSUES-PACKAGE",
            version: "1.0.0",
            bin: {
              "missing1": "./nonexistent1.js",
              "missing2": "./nonexistent2.js",
            },
          },
          null,
          2,
        ),
      });

      try {
        const { code, error } = await runPmPkg(["fix"], multiIssueDir);
        expect(code).toBe(0);

        // Should fix the name
        const { output: nameOutput } = await runPmPkg(["get", "name"], multiIssueDir);
        expect(nameOutput.trim()).toBe('"multiple-issues-package"');

        // Should warn about both missing files
        expect(error).toContain("No bin file found at ./nonexistent1.js");
        expect(error).toContain("No bin file found at ./nonexistent2.js");
      } finally {
        rmSync(multiIssueDir, { recursive: true, force: true });
      }
    });

    it("should not crash on empty bin object", async () => {
      const emptyBinDir = tempDirWithFiles("empty-bin-test", {
        "package.json": JSON.stringify(
          {
            name: "EMPTY-BIN-PACKAGE",
            version: "1.0.0",
            bin: {},
          },
          null,
          2,
        ),
      });

      try {
        const { code } = await runPmPkg(["fix"], emptyBinDir);
        expect(code).toBe(0);

        const { output: nameOutput } = await runPmPkg(["get", "name"], emptyBinDir);
        expect(nameOutput.trim()).toBe('"empty-bin-package"');
      } finally {
        rmSync(emptyBinDir, { recursive: true, force: true });
      }
    });

    it("should handle missing package.json file", async () => {
      const emptyDir = tempDirWithFiles("empty-test", {});

      try {
        const { code, error } = await runPmPkg(["fix"], emptyDir, false);
        expect(code).toBe(1);
        expect(error).toContain("package.json");
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  // npm does the actual "" key, but bun right now doesn't support it
  describe.todo("empty string key compatibility", () => {
    let emptyKeyDir: string;

    beforeEach(() => {
      emptyKeyDir = tempDirWithFiles("empty-key-test", {
        "package.json": JSON.stringify(
          {
            name: "test-package",
            version: "1.0.0",
            "": "empty-key-value",
          },
          null,
          2,
        ),
      });
    });

    afterEach(() => {
      if (emptyKeyDir) {
        rmSync(emptyKeyDir, { recursive: true, force: true });
      }
    });

    it("should get empty string property key (npm compatibility)", async () => {
      const { output, code } = await runPmPkg(["get", ""], emptyKeyDir);
      expect(code).toBe(0);
      expect(output.trim()).toBe('"empty-key-value"');
    });

    it("should set empty string property key", async () => {
      const { code } = await runPmPkg(["set", "=new-empty-value"], emptyKeyDir);
      expect(code).toBe(0);

      const { output } = await runPmPkg(["get", ""], emptyKeyDir);
      expect(output.trim()).toBe('"new-empty-value"');
    });

    it.todo("should delete empty string property key", async () => {
      const { code } = await runPmPkg(["delete", ""], emptyKeyDir);
      expect(code).toBe(0);

      const { output } = await runPmPkg(["get", ""], emptyKeyDir);
      expect(output.trim()).toBe("{}");
    });
  });
});
