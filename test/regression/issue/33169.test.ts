// https://github.com/oven-sh/bun/issues/33169
//
// The Bun VS Code extension read `bun.runtime` and `bun.test.*` through
// `getConfiguration(section)` with no resource scope, so in a multi-root
// workspace VS Code never applied a folder's `.vscode/settings.json` override:
// every folder saw the same workspace-global value. The fix passes the folder
// URI as the configuration scope and raises those settings to `resource` scope.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONTROLLER = "../../../packages/bun-vscode/src/features/tests/bun-test-controller";
const PACKAGE_JSON = join(import.meta.dir, "../../../packages/bun-vscode/package.json");
const DEFAULT_TEST_PATTERN = "**/*{.test.,.spec.,_test_,_spec_}{js,ts,tsx,jsx,mts,cts,cjs,mjs}";

// folder uri string -> fully-qualified setting -> value
const folderSettings: Record<string, Record<string, unknown>> = {
  "file:///repo/packages/api": {
    "bun.test.filePattern": "**/*.spec.ts",
    "bun.test.customFlag": "--coverage",
    "bun.test.customScript": "bun run test:ci",
    "bun.runtime": "/custom/bin/bun",
  },
  "file:///repo/packages/frontend": {
    "bun.test.filePattern": "**/*.test.tsx",
  },
};

class ScopedConfiguration {
  constructor(
    private readonly section: string,
    private readonly scopeKey: string | undefined,
  ) {}

  get<T>(key: string, defaultValue?: T): T | undefined {
    const full = this.section ? `${this.section}.${key}` : key;
    if (this.scopeKey) {
      const overrides = folderSettings[this.scopeKey];
      if (overrides && full in overrides) {
        return overrides[full] as T;
      }
    }
    return defaultValue;
  }
}

function vscodeFactory() {
  return {
    window: {
      createOutputChannel: () => ({ appendLine: () => {} }),
      visibleTextEditors: [],
      showErrorMessage: () => {},
    },
    workspace: {
      getConfiguration: (section?: string, scope?: { toString(): string }) =>
        new ScopedConfiguration(section ?? "", scope ? scope.toString() : undefined),
      onDidOpenTextDocument: () => ({ dispose() {} }),
      textDocuments: [],
      createFileSystemWatcher: () => ({
        onDidChange: () => ({ dispose() {} }),
        onDidCreate: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        dispose() {},
      }),
      findFiles: async () => [],
    },
    RelativePattern: class {
      constructor(
        public base: unknown,
        public pattern: string,
      ) {}
    },
    TestRunProfileKind: { Run: 1, Debug: 2, Coverage: 3 },
  };
}

mock.module("vscode", vscodeFactory);

const { BunTestController } = await import(CONTROLLER);

function makeController(folderPath: string) {
  const uri = { toString: () => `file://${folderPath}`, fsPath: folderPath };
  const folder = { uri, name: folderPath.split("/").pop() ?? folderPath, index: 0 };
  return new BunTestController({} as any, folder as any, true);
}

describe("multi-root workspace config scoping (issue #33169)", () => {
  test("each folder resolves its own filePattern from its folder scope", () => {
    const api = makeController("/repo/packages/api");
    const frontend = makeController("/repo/packages/frontend");
    expect(api._internal.customFilePattern()).toBe("**/*.spec.ts");
    expect(frontend._internal.customFilePattern()).toBe("**/*.test.tsx");
  });

  test("getBunExecutionConfig resolves the folder's runtime, customScript and customFlag", () => {
    const api = makeController("/repo/packages/api");
    const config = api._internal.getBunExecutionConfig();
    expect(config.bunCommand).toBe("/custom/bin/bun");
    expect(config.testArgs).toEqual(["run", "test:ci", "--coverage"]);
  });

  test("a folder without overrides keeps the defaults and does not inherit another folder's settings", () => {
    const frontend = makeController("/repo/packages/frontend");
    expect(frontend._internal.customFilePattern()).toBe("**/*.test.tsx");

    const config = frontend._internal.getBunExecutionConfig();
    expect(config.bunCommand).toBe("bun");
    expect(config.testArgs).toEqual(["test"]);
  });

  test("default pattern is used when no folder scope matches", () => {
    const other = makeController("/repo/packages/other");
    expect(other._internal.customFilePattern()).toBe(DEFAULT_TEST_PATTERN);
  });

  test("per-folder settings are declared with resource scope in package.json", () => {
    const manifest = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
    const props = manifest.contributes.configuration.properties;
    for (const key of ["bun.runtime", "bun.test.filePattern", "bun.test.customFlag", "bun.test.customScript"]) {
      expect(props[key].scope).toBe("resource");
    }
  });
});
