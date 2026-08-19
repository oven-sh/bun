// https://github.com/oven-sh/bun/issues/15485 (#39612 is a duplicate)
// In a multi-root workspace, "Bun: Run File" and "Bun: Debug File" called
// vscode.debug.startDebugging(undefined, ...) with a config that uses
// ${workspaceFolder}. VS Code cannot resolve that variable without a folder
// scope and fails with "Variable workspaceFolder can not be resolved in a
// multi folder workspace". The extension must pass the workspace folder that
// owns the target file, and it must read bun.runtime from that folder.
// This test lives under test/ (not packages/bun-vscode) because CI's test
// runner only discovers files in the test/ directory. It registers its own
// vscode module mock: the shared one in vscode.mock.ts targets the test
// controller and lacks command registration and startDebugging capture.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";
import {
  MockUri,
  MockWorkspaceFolder,
} from "../../../packages/bun-vscode/src/features/tests/__tests__/vscode-types.mock";

const folderApp = new MockWorkspaceFolder(MockUri.file("/repo/app"), "app", 0);
const folderLib = new MockWorkspaceFolder(MockUri.file("/repo/lib"), "lib", 1);
const workspaceFolders = [folderApp, folderLib];

// Only the "lib" folder sets bun.runtime in its folder settings.
const libRuntime = "/repo/lib/node_modules/.bin/bun";

function getWorkspaceFolder(uri: MockUri): MockWorkspaceFolder | undefined {
  return workspaceFolders.find(folder => uri.fsPath.startsWith(folder.uri.fsPath + "/"));
}

// Like VS Code, a configuration scope that is a folder, or a Uri inside a
// folder, resolves that folder's settings. No scope resolves no folder value.
function folderOfScope(scope?: MockWorkspaceFolder | MockUri): MockWorkspaceFolder | undefined {
  if (!scope) return undefined;
  return scope instanceof MockWorkspaceFolder ? scope : getWorkspaceFolder(scope);
}

const startDebugging = mock(async (..._args: unknown[]) => true);
const registeredCommands = new Map<string, (...args: any[]) => unknown>();
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
    getConfiguration: (_section: string, scope?: MockWorkspaceFolder | MockUri) => ({
      get: (key: string) => (key === "runtime" && folderOfScope(scope) === folderLib ? libRuntime : undefined),
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
    registerDebugConfigurationProvider: () => disposable,
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

// One entry per startDebugging call: the folder argument plus the parts of
// the launch config that depend on the folder.
function launches() {
  return startDebugging.mock.calls.map(([folder, config]: any[]) => ({
    folder,
    program: config.program,
    runtime: config.runtime,
  }));
}

beforeEach(() => {
  startDebugging.mockClear();
  mockWindow.activeTextEditor = undefined;
});

describe("multi-root workspace folder resolution", () => {
  test("registerDebugger registered the run and debug commands", () => {
    expect(runFile).toBeInstanceOf(Function);
    expect(debugFile).toBeInstanceOf(Function);
  });

  test("Bun: Run File passes the folder that owns the file and reads bun.runtime from it", () => {
    runFile(MockUri.file("/repo/lib/src/index.ts"));
    runFile(MockUri.file("/repo/app/main.ts"));

    expect(launches()).toEqual([
      { folder: folderLib, program: "/repo/lib/src/index.ts", runtime: libRuntime },
      { folder: folderApp, program: "/repo/app/main.ts", runtime: "bun" },
    ]);
  });

  test("Bun: Debug File passes the folder that owns the file and reads bun.runtime from it", () => {
    debugFile(MockUri.file("/repo/lib/src/index.ts"));
    debugFile(MockUri.file("/repo/app/main.ts"));

    expect(launches()).toEqual([
      { folder: folderLib, program: "/repo/lib/src/index.ts", runtime: libRuntime },
      { folder: folderApp, program: "/repo/app/main.ts", runtime: "bun" },
    ]);
  });

  test("without a resource (command palette, keybinding) both commands use the active editor's folder", () => {
    mockWindow.activeTextEditor = { document: { uri: MockUri.file("/repo/lib/server.ts") } };
    runFile();
    debugFile();

    expect(launches()).toEqual([
      { folder: folderLib, program: "/repo/lib/server.ts", runtime: libRuntime },
      { folder: folderLib, program: "/repo/lib/server.ts", runtime: libRuntime },
    ]);
  });

  test("debugCommand for a package.json script uses the folder of the active editor", () => {
    mockWindow.activeTextEditor = { document: { uri: MockUri.file("/repo/lib/package.json") } };
    debugCommand("dev");

    expect(launches()).toEqual([{ folder: folderLib, program: "dev", runtime: libRuntime }]);
  });

  test("a file outside every workspace folder keeps the previous behavior", () => {
    runFile(MockUri.file("/outside/loose.ts"));
    debugFile(MockUri.file("/outside/loose.ts"));

    expect(launches()).toEqual([
      { folder: undefined, program: "/outside/loose.ts", runtime: "bun" },
      { folder: undefined, program: "/outside/loose.ts", runtime: "bun" },
    ]);
  });

  test("run and debug agree on a foreign file: both fall back to the active editor's folder", () => {
    mockWindow.activeTextEditor = { document: { uri: MockUri.file("/repo/app/main.ts") } };
    runFile(MockUri.file("/outside/loose.ts"));
    debugFile(MockUri.file("/outside/loose.ts"));

    expect(launches()).toEqual([
      { folder: folderApp, program: "/outside/loose.ts", runtime: "bun" },
      { folder: folderApp, program: "/outside/loose.ts", runtime: "bun" },
    ]);
  });
});
