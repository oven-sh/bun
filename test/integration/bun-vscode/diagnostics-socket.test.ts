// Bun's VS Code extension sets BUN_INSPECT_CONNECT_TO in every integrated terminal, which tells every
// `bun` started there to connect its inspector to the extension's diagnostics socket. These tests run
// the extension's diagnostics feature outside of VS Code, against this build of bun.
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import * as net from "node:net";
import { basename, join } from "node:path";
import { SocketFramer } from "../../cli/inspect/socket-framer";

const extensionSrc = join(import.meta.dir, "..", "..", "..", "packages", "bun-vscode", "src");

/** What the extension shows in the editor. Positions are `file:line:column` as bun prints them. */
const diagnostics: { at: string; message: string; related: string[] }[] = [];
/** What the extension writes to its output channel. */
const output: string[] = [];
let changed = () => {};

/** Waits until the extension has shown or written what `done` looks for. */
async function until(done: () => boolean) {
  while (!done()) await new Promise<void>(resolve => (changed = resolve));
}

beforeEach(() => {
  diagnostics.length = 0;
  output.length = 0;
});

class Disposable {
  constructor(public dispose = () => {}) {}
  static from(...disposables: { dispose(): unknown }[]) {
    return new Disposable(() => disposables.forEach(disposable => disposable.dispose()));
  }
}

/** A class that keeps its constructor arguments under these names. */
const keeps = (...names: string[]) =>
  class {
    constructor(...values: unknown[]) {
      names.forEach((name, i) => ((this as any)[name] = values[i]));
    }
  };

/** VS Code counts lines and columns from 0. */
const at = (uri: { path: string }, position: { line: number; character: number }) =>
  `${basename(uri.path)}:${position.line + 1}:${position.character + 1}`;

// `vscode` exists only inside VS Code. This is the part of it that the diagnostics feature uses.
mock.module("vscode", () => ({
  window: {
    createOutputChannel: () => ({
      appendLine(line: string) {
        output.push(line);
        changed();
      },
    }),
  },
  languages: {
    createDiagnosticCollection: () => ({
      clear() {},
      set(uri: { path: string }, [diagnostic]: any[]) {
        diagnostics.push({
          at: at(uri, diagnostic.range.start),
          message: diagnostic.message,
          related: diagnostic.relatedInformation.map(({ location }: any) => at(location.uri, location.position)),
        });
        changed();
      },
    }),
  },
  workspace: { textDocuments: [], onDidChangeTextDocument: () => new Disposable() },
  Uri: { file: (path: string) => ({ path, toString: () => path }) },
  Position: keeps("line", "character"),
  Range: keeps("start", "end"),
  Location: keeps("uri", "position"),
  Diagnostic: keeps("range", "message"),
  DiagnosticRelatedInformation: keeps("location", "message"),
  DiagnosticSeverity: { Error: 0 },
  MarkdownString: class {},
  Disposable,
}));
// extension.ts loads every feature of the extension. The diagnostics feature only reads settings from it.
mock.module(join(extensionSrc, "extension.ts"), () => ({ getConfig: () => true }));

/** The part of `vscode.ExtensionContext` that the diagnostics feature uses. */
type ExtensionContext = {
  subscriptions: { dispose(): { dispose(): void } | void }[];
  environmentVariableCollection: { clear(): void; replace(name: string, value: string): void };
};

// A static import would load the feature before the mocks are in place.
const feature: { registerDiagnosticsSocket(context: ExtensionContext): Promise<void> } = await import(
  join(extensionSrc, "features", "diagnostics", "diagnostics.ts")
);

// The extension registers the socket one time, when it activates.
const terminalEnv: Record<string, string> = {};
const context: ExtensionContext = {
  subscriptions: [],
  environmentVariableCollection: { clear() {}, replace: (name, value) => void (terminalEnv[name] = value) },
};
await feature.registerDiagnosticsSocket(context);
// BunDiagnosticsManager.dispose() does not close the socket. It returns the disposable that does.
afterAll(() => context.subscriptions.forEach(subscription => subscription.dispose()?.dispose()));

/** Connects to the extension's socket, as a bun process does. */
function connectToExtension() {
  // unix://<path>, or tcp://127.0.0.1:<port> on Windows.
  const url = terminalEnv.BUN_INSPECT_CONNECT_TO;
  return url.startsWith("unix://")
    ? net.connect(url.slice("unix://".length))
    : net.connect(Number(new URL(url).port), "127.0.0.1");
}

/** Passes everything between a bun process and the extension's socket, and records the inspector messages. */
async function relay() {
  /** The methods the extension called. */
  const requests: string[] = [];
  /** The events bun sent. */
  const events: string[] = [];
  const enabled = Promise.withResolvers<void>();
  let lifecycleReporterEnable: number | undefined;

  const server = net.createServer(bun => {
    const extension = connectToExtension();
    const fromExtension = new SocketFramer(text => {
      const { id, method } = JSON.parse(text);
      requests.push(method);
      if (method === "LifecycleReporter.enable") lifecycleReporterEnable = id;
    });
    const fromBun = new SocketFramer(text => {
      const { id, method } = JSON.parse(text);
      if (method) events.push(method);
      else if (id === lifecycleReporterEnable) enabled.resolve();
    });
    extension.on("data", (data: Buffer) => {
      fromExtension.onData(extension as any, data);
      bun.write(data);
    });
    bun.on("data", (data: Buffer) => {
      fromBun.onData(bun as any, data);
      extension.write(data);
    });
    bun.on("error", enabled.reject);
    extension.on("error", enabled.reject);
    bun.on("close", () => {
      extension.destroy();
      enabled.reject(new Error("bun closed the inspector socket before it answered"));
    });
    extension.on("close", () => {
      bun.destroy();
      enabled.reject(new Error("the extension closed the inspector socket before bun answered"));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `tcp://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    requests,
    events,
    /** Resolves when bun has answered `LifecycleReporter.enable`. */
    enabled: enabled.promise,
    close: () => void server.close(),
  };
}

/** Starts the fixture with its inspector on a relay to the extension. */
async function startFixture() {
  const connection = await relay();
  const serverUrl = Promise.withResolvers<string>();
  const proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "diagnostics-socket-fixture.ts")],
    env: { ...bunEnv, BUN_INSPECT_CONNECT_TO: connection.url },
    stdout: "pipe",
    stderr: "pipe",
    ipc: serverUrl.resolve,
  });
  const stderr = proc.stderr.text();
  // A process that dies fails the step that waits for it with what it printed, not with a timeout.
  const died = proc.exited.then(async code => {
    throw new Error(`bun exited (${code ?? proc.signalCode}):\n${await stderr}`);
  });
  died.catch(() => {});
  const alive = <T>(step: Promise<T>) => Promise.race([step, died]);
  return { connection, proc, stderr, alive, serverUrl: serverUrl.promise };
}

const fixture = await startFixture();
afterAll(() => {
  fixture.proc.kill();
  fixture.connection.close();
});
// Not in a test: the first start of a debug build can take longer than the 5 seconds that a test has.
beforeAll(() => fixture.alive(Promise.all([fixture.connection.enabled, fixture.serverUrl])), 60_000);

test("a bun process gets one request, and sends the error but no console output", async () => {
  const { connection, proc, stderr, alive, serverUrl } = fixture;
  // The fixture prints three lines, then logs an error and throws it. bun sends events in order, so a
  // console event for one of those calls would come before the error that the extension shows.
  await alive(fetch(await serverUrl));
  await alive(until(() => diagnostics.length > 0));
  proc.kill();

  expect({
    printed: await proc.stdout.text(),
    // Printed two times: when the fixture logs the error, and when bun reports the throw.
    stack: (await stderr)
      .split("\n")
      .filter(line => line.trimStart().startsWith("at "))
      .map(line => line.trim().replace(/\(.*[\\/]/, "(")),
    requests: connection.requests,
    events: connection.events,
    diagnostics,
  }).toEqual({
    printed: "line 0\nline 1\nline 2\n",
    // With the Console domain on, bun puts `at URL (unknown:1:1)` first, and the diagnostic goes to `unknown`.
    stack: [
      "at target (diagnostics-socket-fixture.ts:4:10)",
      "at fetch (diagnostics-socket-fixture.ts:12:32)",
      "at target (diagnostics-socket-fixture.ts:4:10)",
      "at fetch (diagnostics-socket-fixture.ts:12:32)",
    ],
    requests: ["LifecycleReporter.enable"],
    events: ["LifecycleReporter.error"],
    diagnostics: [
      {
        at: "diagnostics-socket-fixture.ts:4:10",
        message: "Invalid URL",
        related: ["diagnostics-socket-fixture.ts:12:32"],
      },
    ],
  });
});

test("a process that exits before it answers leaves one line in the output channel", async () => {
  // In the place of a bun process: it reads the request of the extension, and closes with no answer.
  const bun = connectToExtension();
  const request = Promise.withResolvers<void>();
  const fromExtension = new SocketFramer(() => request.resolve());
  bun.on("data", (data: Buffer) => fromExtension.onData(bun as any, data));
  bun.on("error", request.reject);
  bun.on("close", () => request.reject(new Error("the extension closed the socket before it sent a request")));
  await request.promise;
  bun.destroy();

  // Without a handler, the rejected request is an unhandled rejection in the extension host.
  await until(() => output.some(line => line.includes("failed")));
  expect(output).toEqual([
    "Clearing all because: A new socket connected",
    "LifecycleReporter.enable failed: Socket closed while waiting for: LifecycleReporter.enable",
  ]);
});
