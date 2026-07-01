// https://github.com/oven-sh/bun/issues/33169
//
// The Bun VS Code extension read `bun.runtime` and `bun.test.*` through
// `getConfiguration(section)` with no resource scope, so in a multi-root
// workspace VS Code never applied a folder's `.vscode/settings.json` override:
// every folder saw the same workspace-global value, and only the first folder
// got a test controller. The fix passes the folder URI as the configuration
// scope, raises those settings to `resource` scope, and creates one controller
// per workspace folder.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONTROLLER = "../../../packages/bun-vscode/src/features/tests/bun-test-controller";
const INDEX = "../../../packages/bun-vscode/src/features/tests/index";
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
  "file:///ws/disabled": {
    "bun.test.enable": false,
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

let workspaceFolders: any[] = [];
let folderChangeListener: ((e: { added: any[]; removed: any[] }) => void) | undefined;
const createdControllers: any[] = [];

function vscodeFactory() {
  return {
    window: {
      createOutputChannel: () => ({ appendLine: () => {} }),
      visibleTextEditors: [],
      showErrorMessage: () => {},
    },
    workspace: {
      get workspaceFolders() {
        return workspaceFolders;
      },
      getConfiguration: (section?: string, scope?: { toString(): string }) =>
        new ScopedConfiguration(section ?? "", scope ? scope.toString() : undefined),
      onDidOpenTextDocument: () => ({ dispose() {} }),
      onDidChangeWorkspaceFolders: (listener: (e: { added: any[]; removed: any[] }) => void) => {
        folderChangeListener = listener;
        return { dispose() {} };
      },
      textDocuments: [],
      createFileSystemWatcher: () => ({
        onDidChange: () => ({ dispose() {} }),
        onDidCreate: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        dispose() {},
      }),
      findFiles: async () => [],
    },
    tests: {
      createTestController: (id: string, label: string) => {
        const controller: any = { id, label, disposed: false };
        controller.dispose = () => {
          controller.disposed = true;
        };
        createdControllers.push(controller);
        return controller;
      },
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
const { registerTests } = await import(INDEX);

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

describe("registerTests multi-root controllers (issue #33169)", () => {
  type Built = { controller: any; folder: any; disposed: boolean };

  function recordingFactory(records: Built[]) {
    return (controller: any, folder: any) => {
      const rec: Built = { controller, folder, disposed: false };
      records.push(rec);
      return {
        dispose() {
          rec.disposed = true;
        },
      };
    };
  }

  function makeContext() {
    return { subscriptions: [] as any[] } as any;
  }

  function wsFolder(folderPath: string, name: string) {
    const uri = { toString: () => `file://${folderPath}`, fsPath: folderPath };
    return { uri, name, index: 0 };
  }

  beforeEach(() => {
    workspaceFolders = [];
    folderChangeListener = undefined;
    createdControllers.length = 0;
  });

  test("creates one controller per workspace folder with folder-qualified labels", async () => {
    workspaceFolders = [wsFolder("/ws/a", "a"), wsFolder("/ws/b", "b")];
    const records: Built[] = [];
    await registerTests(makeContext(), recordingFactory(records));

    expect(records.map(r => r.folder.name)).toEqual(["a", "b"]);
    expect(createdControllers.map(c => c.id)).toEqual(["bun:file:///ws/a", "bun:file:///ws/b"]);
    expect(createdControllers.map(c => c.label)).toEqual(["Bun Tests (a)", "Bun Tests (b)"]);
  });

  test("uses the plain label for a single-folder workspace", async () => {
    workspaceFolders = [wsFolder("/ws/only", "only")];
    await registerTests(makeContext(), recordingFactory([]));

    expect(createdControllers.map(c => c.label)).toEqual(["Bun Tests"]);
  });

  test("skips folders where bun.test.enable is false", async () => {
    workspaceFolders = [wsFolder("/ws/a", "a"), wsFolder("/ws/disabled", "disabled")];
    const records: Built[] = [];
    await registerTests(makeContext(), recordingFactory(records));

    expect(records.map(r => r.folder.name)).toEqual(["a"]);
  });

  test("disposes the created controller when the factory throws", async () => {
    workspaceFolders = [wsFolder("/ws/a", "a")];
    await registerTests(makeContext(), () => {
      throw new Error("boom");
    });

    expect(createdControllers).toHaveLength(1);
    expect(createdControllers[0].disposed).toBe(true);
  });

  test("adds, relabels and removes controllers as folders change", async () => {
    const a = wsFolder("/ws/a", "a");
    workspaceFolders = [a];
    const records: Built[] = [];
    await registerTests(makeContext(), recordingFactory(records));
    expect(createdControllers.map(c => c.label)).toEqual(["Bun Tests"]);

    const b = wsFolder("/ws/b", "b");
    workspaceFolders = [a, b];
    folderChangeListener?.({ added: [b], removed: [] });
    expect(records.map(r => r.folder.name)).toEqual(["a", "b"]);
    expect(createdControllers.map(c => c.label)).toEqual(["Bun Tests (a)", "Bun Tests (b)"]);

    workspaceFolders = [a];
    folderChangeListener?.({ added: [], removed: [b] });
    expect(records.find(r => r.folder.name === "b")?.disposed).toBe(true);
    expect(createdControllers.find(c => c.id === "bun:file:///ws/a")?.label).toBe("Bun Tests");
  });
});
