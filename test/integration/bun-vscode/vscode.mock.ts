// A minimal stand-in for the `vscode` module, enough to drive the package.json
// CodeLens and hover providers of packages/bun-vscode outside of VS Code.
// Import this file before the module under test so the mocks are registered first.
import { mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const vscodeSrc = join(import.meta.dirname, "../../../packages/bun-vscode/src");

export class Uri {
  constructor(public fsPath: string) {}
  static file(path: string) {
    return new Uri(path);
  }
  toString() {
    return `file://${this.fsPath}`;
  }
}

export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
  isBeforeOrEqual(other: Position) {
    return this.line < other.line || (this.line === other.line && this.character <= other.character);
  }
}

export class Range {
  constructor(
    public start: Position,
    public end: Position,
  ) {}
  contains(position: Position) {
    return this.start.isBeforeOrEqual(position) && position.isBeforeOrEqual(this.end);
  }
}

export class CodeLens {
  constructor(
    public range: Range,
    public command: { title: string; command: string; arguments: unknown[] },
  ) {}
}

export class MarkdownString {
  isTrusted = false;
  constructor(public value: string) {}
}

class ShellExecution {
  constructor(public commandLine: string) {}
}

class Task {
  detail?: string;
  constructor(
    public definition: { type: string; script: string },
    public scope: unknown,
    public name: string,
    public source: string,
    public execution?: unknown,
  ) {}
}

export interface Terminal {
  name: string;
  creationOptions: { name: string; cwd?: string };
  sent: string[];
  show(): void;
  sendText(text: string): void;
}

export interface QuickPickItem {
  label: string;
  detail?: string;
}

export interface TextDocument {
  uri: Uri;
  getText(): string;
  positionAt(offset: number): Position;
}

export const commands = new Map<string, (...args: any[]) => unknown>();

export const state = {
  workspaceRoot: "",
  pickLabel: "",
  quickPickItems: [] as QuickPickItem[],
  terminals: [] as Terminal[],
  debugSessions: [] as Record<string, unknown>[],
  configScopes: [] as (Uri | undefined)[],
  codeLensProvider: null as null | { provideCodeLenses(document: TextDocument): CodeLens[] },
  hoverSelector: null as unknown,
  hoverProvider: null as null | { provideHover(document: TextDocument, position: Position): { contents: unknown[] } },
  provideTasks: async (): Promise<Task[]> => [],
};

export function makeDocument(fsPath: string): TextDocument {
  const text = readFileSync(fsPath, "utf8");
  return {
    uri: Uri.file(fsPath),
    getText: () => text,
    positionAt(offset: number) {
      const before = text.slice(0, offset);
      const line = before.split("\n").length - 1;
      const character = offset - (before.lastIndexOf("\n") + 1);
      return new Position(line, character);
    },
  };
}

mock.module("vscode", () => ({
  Uri,
  Position,
  Range,
  CodeLens,
  MarkdownString,
  ShellExecution,
  Task,
  TaskScope: { Global: 1, Workspace: 2 },
  workspace: {
    get workspaceFolders() {
      return [{ uri: Uri.file(state.workspaceRoot) }];
    },
    fs: {
      readFile: async (uri: Uri) => readFileSync(uri.fsPath),
    },
    openTextDocument: async (uri: Uri) => makeDocument(uri.fsPath),
  },
  window: {
    get terminals() {
      return state.terminals;
    },
    showQuickPick: async (items: QuickPickItem[]) => {
      state.quickPickItems = items;
      return items.find(item => item.label === state.pickLabel);
    },
    createTerminal: (options: { name: string; cwd?: string }) => {
      const terminal: Terminal = {
        name: options.name,
        creationOptions: options,
        sent: [],
        show() {},
        sendText(text: string) {
          this.sent.push(text);
        },
      };
      state.terminals.push(terminal);
      return terminal;
    },
  },
  commands: {
    registerCommand: (id: string, fn: (...args: any[]) => unknown) => {
      commands.set(id, fn);
      return { dispose() {} };
    },
    executeCommand: (id: string, ...args: unknown[]) => commands.get(id)!(...args),
  },
  languages: {
    registerCodeLensProvider: (_selector: unknown, provider: typeof state.codeLensProvider) => {
      state.codeLensProvider = provider;
      return { dispose() {} };
    },
    registerHoverProvider: (selector: unknown, provider: typeof state.hoverProvider) => {
      state.hoverSelector = selector;
      state.hoverProvider = provider;
      return { dispose() {} };
    },
  },
  tasks: {
    fetchTasks: async () => state.provideTasks(),
  },
  debug: {
    startDebugging: async (_folder: unknown, configuration: Record<string, unknown>) => {
      state.debugSessions.push(configuration);
      return true;
    },
  },
}));

// features/debug.ts is loaded for real. Its imports below are only used inside the debug adapter
// session classes, which this test never instantiates.
mock.module("@vscode/debugadapter", () => ({
  DebugSession: class {},
  OutputEvent: class {},
}));
mock.module(join(vscodeSrc, "../../bun-debug-adapter-protocol/index.ts"), () => ({
  getAvailablePort: async () => 0,
  getRandomId: () => "",
  TCPSocketSignal: class {},
  UnixSignal: class {},
  WebSocketDebugAdapter: class {},
}));
mock.module(join(vscodeSrc, "extension.ts"), () => ({
  getConfig: (_path: string, scope?: Uri) => {
    state.configScopes.push(scope);
    return undefined;
  },
}));
