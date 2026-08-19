// https://github.com/oven-sh/bun/issues/39612
// In a multi-root workspace, "Bun: Run File" and "Bun: Debug File" called
// vscode.debug.startDebugging(undefined, ...) with a config that uses
// ${workspaceFolder}. VS Code cannot resolve that variable without a folder
// scope and fails with "Variable workspaceFolder can not be resolved in a
// multi folder workspace". The extension must pass the workspace folder that
// owns the target file.
// This test lives under test/ (not packages/bun-vscode) because CI's test
// runner only discovers files in the test/ directory. It reuses the
// extension's shared mock types, but registers its own vscode module mock:
// the shared one in vscode.mock.ts targets the test controller and lacks
// command registration and startDebugging capture.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";
import {
  MockUri,
  MockWorkspaceFolder,
} from "../../../packages/bun-vscode/src/features/tests/__tests__/vscode-types.mock";

const folderApp = new MockWorkspaceFolder(MockUri.file("/repo/app"), "app", 0);
const folderLib = new MockWorkspaceFolder(MockUri.file("/repo/lib"), "lib", 1);
const workspaceFolders = [folderApp, folderLib];

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
    getWorkspaceFolder: (uri: MockUri) =>
      workspaceFolders.find(folder => uri.fsPath.startsWith(folder.uri.fsPath + "/")),
    getConfiguration: () => ({ get: () => undefined }),
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

beforeEach(() => {
  startDebugging.mockClear();
  mockWindow.activeTextEditor = undefined;
});

describe("multi-root workspace folder resolution", () => {
  test("registerDebugger registered the run and debug commands", () => {
    expect(runFile).toBeInstanceOf(Function);
    expect(debugFile).toBeInstanceOf(Function);
  });

  test("Bun: Run File passes the folder that owns the file", () => {
    runFile(MockUri.file("/repo/lib/src/index.ts"));

    expect(startDebugging).toHaveBeenCalledTimes(1);
    const [folder, config] = startDebugging.mock.calls[0] as any[];
    expect(config.program).toBe("/repo/lib/src/index.ts");
    expect(folder).toBe(folderLib);
  });

  test("Bun: Debug File passes the folder that owns the file", () => {
    debugFile(MockUri.file("/repo/app/main.ts"));

    expect(startDebugging).toHaveBeenCalledTimes(1);
    const [folder, config] = startDebugging.mock.calls[0] as any[];
    expect(config.program).toBe("/repo/app/main.ts");
    expect(folder).toBe(folderApp);
  });

  test("commands fall back to the active editor's folder", () => {
    mockWindow.activeTextEditor = { document: { uri: MockUri.file("/repo/app/server.ts") } };
    runFile();

    expect(startDebugging).toHaveBeenCalledTimes(1);
    const [folder, config] = startDebugging.mock.calls[0] as any[];
    expect(config.program).toBe("/repo/app/server.ts");
    expect(folder).toBe(folderApp);
  });

  test("debugCommand derives the folder from the active editor", () => {
    mockWindow.activeTextEditor = { document: { uri: MockUri.file("/repo/lib/package.json") } };
    debugCommand("dev");

    expect(startDebugging).toHaveBeenCalledTimes(1);
    const [folder, config] = startDebugging.mock.calls[0] as any[];
    expect(config.program).toBe("dev");
    expect(folder).toBe(folderLib);
  });

  test("a file outside every workspace folder keeps the previous behavior", () => {
    runFile(MockUri.file("/outside/loose.ts"));

    expect(startDebugging).toHaveBeenCalledTimes(1);
    const [folder] = startDebugging.mock.calls[0] as any[];
    expect(folder).toBeUndefined();
  });

  test("run and debug agree on a foreign file: both fall back to the active editor's folder", () => {
    mockWindow.activeTextEditor = { document: { uri: MockUri.file("/repo/app/main.ts") } };
    runFile(MockUri.file("/outside/loose.ts"));
    debugFile(MockUri.file("/outside/loose.ts"));

    expect(startDebugging).toHaveBeenCalledTimes(2);
    const [runFolder] = startDebugging.mock.calls[0] as any[];
    const [debugFolder] = startDebugging.mock.calls[1] as any[];
    expect(runFolder).toBe(folderApp);
    expect(debugFolder).toBe(folderApp);
  });
});
