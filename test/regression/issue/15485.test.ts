// https://github.com/oven-sh/bun/issues/15485 (#39612 is a duplicate; #11925 reports the same commands in a window without a folder)
// "Bun: Run File" and "Bun: Debug File" called vscode.debug.startDebugging(undefined, ...)
// with a config whose cwd is "${workspaceFolder}". VS Code resolves that variable only
// against the folder passed to startDebugging, or against the single folder of a
// single-root window. So the commands failed in a multi-root window ("Variable
// workspaceFolder can not be resolved in a multi folder workspace") and in a window
// without a folder ("Please open a folder"). The commands must pass the folder that owns
// the file, so that VS Code scopes the launch (and the bun.runtime setting) to it, and
// must set a concrete cwd, so that a file that no folder owns still launches.
// This test lives under test/ (not packages/bun-vscode) because CI's test
// runner only discovers files in the test/ directory. It registers its own
// vscode module mock: the shared one in vscode.mock.ts targets the test
// controller and lacks command registration and startDebugging capture.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";
import {
  MockUri,
  MockWorkspaceFolder,
} from "../../../packages/bun-vscode/src/features/tests/__tests__/vscode-types.mock";

const folderApp = new MockWorkspaceFolder(MockUri.file("/repo/app"), "app", 0);
const folderLib = new MockWorkspaceFolder(MockUri.file("/repo/lib"), "lib", 1);
// The folders of the mocked window. The describe blocks below change them.
const workspaceFolders: MockWorkspaceFolder[] = [];

// Only the "lib" folder sets bun.runtime in its folder settings.
const libRuntime = "/repo/lib/node_modules/.bin/bun";

function getWorkspaceFolder(uri: MockUri): MockWorkspaceFolder | undefined {
  return workspaceFolders.find(folder => uri.fsPath.startsWith(folder.uri.fsPath + "/"));
}

const startDebugging = mock(async (..._args: unknown[]) => true);
const registeredCommands = new Map<string, (...args: any[]) => unknown>();
const configurationProviders: any[] = [];
const disposable = { dispose() {} };

const mockWindow = {
  activeTextEditor: undefined as undefined | { document: { uri: MockUri } },
  visibleTextEditors: [],
  createOutputChannel: () => ({ appendLine() {} }),
};

mock.module("vscode", () => ({
  window: mockWindow,
  workspace: {
    workspaceFolders,
    getWorkspaceFolder,
    getConfiguration: (_section: string, scope?: unknown) => ({
      get: (key: string) => (key === "runtime" && scope === folderLib ? libRuntime : undefined),
    }),
    onDidOpenTextDocument: () => disposable,
    textDocuments: [],
  },
  commands: {
    registerCommand: (name: string, callback: (...args: any[]) => unknown) => {
      registeredCommands.set(name, callback);
      return disposable;
    },
  },
  languages: {
    registerCodeLensProvider: () => disposable,
  },
  debug: {
    startDebugging,
    registerDebugConfigurationProvider: (_type: string, provider: unknown) => {
      configurationProviders.push(provider);
      return disposable;
    },
    registerDebugAdapterDescriptorFactory: () => disposable,
  },
  DebugConfigurationProviderTriggerKind: { Initial: 1, Dynamic: 2 },
  Uri: MockUri,
  Range: class {},
  Position: class {},
  CodeLens: class {},
  ThemeIcon: class {},
  TerminalProfile: class {},
  MarkdownString: class {},
  EventEmitter: class {
    event = () => disposable;
    fire() {}
  },
  TestTag: class {},
  TestMessage: class {},
  TestRunProfileKind: { Run: 1, Debug: 2, Coverage: 3 },
  RelativePattern: class {},
  Location: class {},
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Task: class {},
  TaskScope: { Workspace: 1, Global: 2 },
  ShellExecution: class {},
  TaskRevealKind: { Always: 1, Silent: 2, Never: 3 },
  TaskPanelKind: { Shared: 1, Dedicated: 2, New: 3 },
}));

// The unfixed debug.ts also imports OutputEvent. The stub keeps that version
// loadable, so that this test fails on its assertions against it, not at import.
mock.module("@vscode/debugadapter", () => ({
  DebugSession: class {
    sendEvent() {}
    sendResponse() {}
    sendRequest() {}
  },
  OutputEvent: class {},
}));

// Stub the adapter package so the test does not pull in its "ws" dependency.
mock.module(path.join(import.meta.dir, "../../../packages/bun-debug-adapter-protocol/index.ts"), () => ({
  getAvailablePort: async () => 0,
  getRandomId: () => "id",
  TCPSocketSignal: class {},
  UnixSignal: class {},
  WebSocketDebugAdapter: class {},
  NodeSocketDebugAdapter: class {},
}));

const { registerDebugger, debugCommand } = await import("../../../packages/bun-vscode/src/features/debug.ts");

registerDebugger({ subscriptions: { push() {} } } as any);

const runFile = registeredCommands.get("extension.bun.runFile")!;
const debugFile = registeredCommands.get("extension.bun.debugFile")!;

// One entry per startDebugging call. Like VS Code, the config first goes
// through resolveDebugConfiguration of every registered provider, with the
// folder that was passed to startDebugging. That step fills in the runtime.
function resolvedLaunches(): Array<{ folder: unknown; config: Record<string, unknown> }> {
  return startDebugging.mock.calls.map(([folder, launch]: any[]) => {
    let config = { ...launch };
    for (const provider of configurationProviders) {
      config = provider.resolveDebugConfiguration(folder, config);
    }
    return { folder, config };
  });
}

function launches() {
  return resolvedLaunches().map(({ folder, config }) => ({
    folder,
    noDebug: config.noDebug,
    program: config.program,
    cwd: config.cwd,
    runtime: config.runtime,
  }));
}

// VS Code substitutes "${...}" variables after the providers ran, and fails
// the launch when one of them cannot be resolved without a folder.
function unresolvedVariables() {
  return resolvedLaunches().flatMap(({ config }) =>
    Object.values(config).filter(value => typeof value === "string" && value.includes("${")),
  );
}

function useFolders(...folders: MockWorkspaceFolder[]) {
  beforeEach(() => {
    workspaceFolders.push(...folders);
  });
  afterEach(() => {
    workspaceFolders.length = 0;
  });
}

beforeEach(() => {
  startDebugging.mockClear();
  mockWindow.activeTextEditor = undefined;
});

test("registerDebugger registered the run and debug commands and a configuration provider", () => {
  expect(runFile).toBeInstanceOf(Function);
  expect(debugFile).toBeInstanceOf(Function);
  expect(configurationProviders.length).toBeGreaterThan(0);
});

describe("multi-root window", () => {
  useFolders(folderApp, folderLib);

  test("Bun: Run File launches in the folder that owns the file, with that folder's bun.runtime", () => {
    runFile(MockUri.file("/repo/lib/src/index.ts"));
    runFile(MockUri.file("/repo/app/main.ts"));

    expect(launches()).toEqual([
      { folder: folderLib, noDebug: true, program: "/repo/lib/src/index.ts", cwd: "/repo/lib", runtime: libRuntime },
      { folder: folderApp, noDebug: true, program: "/repo/app/main.ts", cwd: "/repo/app", runtime: "bun" },
    ]);
  });

  test("Bun: Debug File launches in the folder that owns the file, with that folder's bun.runtime", () => {
    debugFile(MockUri.file("/repo/lib/src/index.ts"));
    debugFile(MockUri.file("/repo/app/main.ts"));

    expect(launches()).toEqual([
      { folder: folderLib, program: "/repo/lib/src/index.ts", cwd: "/repo/lib", runtime: libRuntime },
      { folder: folderApp, program: "/repo/app/main.ts", cwd: "/repo/app", runtime: "bun" },
    ]);
  });

  test("without a resource (command palette, keybinding) both commands launch the file in the active editor", () => {
    mockWindow.activeTextEditor = { document: { uri: MockUri.file("/repo/lib/server.ts") } };
    runFile();
    debugFile();

    expect(launches()).toEqual([
      { folder: folderLib, noDebug: true, program: "/repo/lib/server.ts", cwd: "/repo/lib", runtime: libRuntime },
      { folder: folderLib, program: "/repo/lib/server.ts", cwd: "/repo/lib", runtime: libRuntime },
    ]);
  });

  test("without a resource and without an active editor nothing launches", () => {
    runFile();
    debugFile();
    debugCommand("dev");

    expect(launches()).toEqual([]);
  });

  test("debugCommand launches a script in the folder of the package.json in the active editor", () => {
    mockWindow.activeTextEditor = { document: { uri: MockUri.file("/repo/lib/package.json") } };
    debugCommand("dev");

    expect(launches()).toEqual([{ folder: folderLib, program: "dev", cwd: "/repo/lib", runtime: libRuntime }]);
  });

  test("debugCommand for a package.json that no folder owns launches in the package.json's directory", () => {
    mockWindow.activeTextEditor = { document: { uri: MockUri.file("/outside/package.json") } };
    debugCommand("dev");

    expect(launches()).toEqual([{ folder: undefined, program: "dev", cwd: "/outside", runtime: "bun" }]);
    expect(unresolvedVariables()).toEqual([]);
  });

  test("a file that no folder owns launches in its own directory", () => {
    mockWindow.activeTextEditor = { document: { uri: MockUri.file("/repo/app/main.ts") } };
    runFile(MockUri.file("/outside/loose.ts"));
    debugFile(MockUri.file("/outside/loose.ts"));

    expect(launches()).toEqual([
      { folder: undefined, noDebug: true, program: "/outside/loose.ts", cwd: "/outside", runtime: "bun" },
      { folder: undefined, program: "/outside/loose.ts", cwd: "/outside", runtime: "bun" },
    ]);
    expect(unresolvedVariables()).toEqual([]);
  });
});

describe("single-root window", () => {
  useFolders(folderLib);

  test("a file inside the folder launches in the folder", () => {
    runFile(MockUri.file("/repo/lib/src/index.ts"));
    debugFile(MockUri.file("/repo/lib/src/index.ts"));

    expect(launches()).toEqual([
      { folder: folderLib, noDebug: true, program: "/repo/lib/src/index.ts", cwd: "/repo/lib", runtime: libRuntime },
      { folder: folderLib, program: "/repo/lib/src/index.ts", cwd: "/repo/lib", runtime: libRuntime },
    ]);
  });

  test("a file outside the folder still launches in the folder, as ${workspaceFolder} resolved before", () => {
    mockWindow.activeTextEditor = { document: { uri: MockUri.file("/outside/package.json") } };
    runFile(MockUri.file("/outside/loose.ts"));
    debugFile(MockUri.file("/outside/loose.ts"));
    debugCommand("dev");

    expect(launches()).toEqual([
      { folder: folderLib, noDebug: true, program: "/outside/loose.ts", cwd: "/repo/lib", runtime: libRuntime },
      { folder: folderLib, program: "/outside/loose.ts", cwd: "/repo/lib", runtime: libRuntime },
      { folder: folderLib, program: "dev", cwd: "/repo/lib", runtime: libRuntime },
    ]);
  });
});

describe("window without a folder", () => {
  test("both commands launch the file in its own directory", () => {
    mockWindow.activeTextEditor = { document: { uri: MockUri.file("/home/me/scripts/222.js") } };
    runFile();
    debugFile(MockUri.file("/home/me/scripts/111/111.js"));

    expect(launches()).toEqual([
      { folder: undefined, noDebug: true, program: "/home/me/scripts/222.js", cwd: "/home/me/scripts", runtime: "bun" },
      { folder: undefined, program: "/home/me/scripts/111/111.js", cwd: "/home/me/scripts/111", runtime: "bun" },
    ]);
    expect(unresolvedVariables()).toEqual([]);
  });

  test("debugCommand launches a script in the directory of the package.json", () => {
    mockWindow.activeTextEditor = { document: { uri: MockUri.file("/home/me/scripts/package.json") } };
    debugCommand("dev");

    expect(launches()).toEqual([{ folder: undefined, program: "dev", cwd: "/home/me/scripts", runtime: "bun" }]);
    expect(unresolvedVariables()).toEqual([]);
  });
});
