// `bun lint --lsp`: the language server over standard input and output, as an editor uses it. It lints and formats.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const command = [bunExe(), "lint", "--lsp"];

// `bun lint` is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

// Each test spawns a debug build and waits for initialize, a lint or format and exit, which is seconds under ASAN; a
// JavaScript plugin runs in a VM, which takes seconds more to start.
const timeout = isDebug || isASAN ? 120_000 : 10_000;

type Message = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string };
};

type Position = { line: number; character: number };
type TextEdit = { range: { start: Position; end: Position }; newText: string };

/** Splits what the server writes into messages: `Content-Length: <bytes>`, an empty line, the JSON. */
class Framer {
  private buffered = Buffer.alloc(0);
  /** What is no frame: text before a header, a header without a length, a body that is not JSON. */
  readonly garbage: string[] = [];

  constructor(private onMessage: (message: Message) => void) {}

  push(chunk: Uint8Array) {
    this.buffered = this.buffered.length ? Buffer.concat([this.buffered, chunk]) : Buffer.from(chunk);
    for (;;) {
      const end = this.buffered.indexOf("\r\n\r\n");
      if (end < 0) return;
      const header = this.buffered.toString("utf8", 0, end);
      const length = /(^|\r\n)Content-Length: (\d+)$/.exec(header);
      if (!length) {
        this.garbage.push(header);
        this.buffered = this.buffered.subarray(end + 4);
        continue;
      }
      if (length.index > 0) this.garbage.push(header.slice(0, length.index));
      const size = Number(length[2]);
      if (this.buffered.length < end + 4 + size) return;
      const body = this.buffered.toString("utf8", end + 4, end + 4 + size);
      this.buffered = this.buffered.subarray(end + 4 + size);
      try {
        this.onMessage(JSON.parse(body));
      } catch {
        this.garbage.push(body);
      }
    }
  }

  /** What follows the last frame. */
  get rest() {
    return this.buffered.toString();
  }
}

/** A client of the server: sends requests and notifications, awaits answers and notifications. */
class Client {
  readonly proc;
  private readonly framer: Framer;
  private next = 0;
  private readonly waiting = new Map<number, { resolve: (message: Message) => void; reject: (why: Error) => void }>();
  /** Notifications and requests of the server that nothing has awaited yet. */
  private readonly unclaimed: Message[] = [];
  private readonly watchers: { test: (message: Message) => boolean; resolve: (message: Message) => void }[] = [];
  /** Everything the server has sent, in order. */
  readonly received: Message[] = [];
  private readonly stderr: Promise<string>;
  /** Resolves when the server has closed its standard output. */
  private readonly done: Promise<void>;

  constructor(cwd: string) {
    this.proc = spawn({ cmd: command, env: bunEnv, cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    this.framer = new Framer(message => this.take(message));
    this.stderr = this.proc.stderr.text();
    this.done = this.read();
  }

  private async read() {
    for await (const chunk of this.proc.stdout) this.framer.push(chunk);
    for (const { reject } of this.waiting.values()) reject(new Error("The server ended before it answered"));
    this.waiting.clear();
  }

  private take(message: Message) {
    this.received.push(message);
    if (message.method === undefined && typeof message.id === "number") {
      const waiting = this.waiting.get(message.id);
      this.waiting.delete(message.id);
      waiting?.resolve(message);
      return;
    }
    const at = this.watchers.findIndex(it => it.test(message));
    if (at < 0) return void this.unclaimed.push(message);
    const [watcher] = this.watchers.splice(at, 1);
    watcher.resolve(message);
  }

  private send(message: object) {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    this.proc.stdin.flush();
  }

  request(method: string, params: unknown = {}): Promise<Message> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: unknown = {}) {
    this.send({ method, params });
  }

  /** The next message of the server that `test` accepts, among those that came already or the ones to come. */
  notification(test: (message: Message) => boolean): Promise<Message> {
    const at = this.unclaimed.findIndex(test);
    if (at >= 0) return Promise.resolve(this.unclaimed.splice(at, 1)[0]);
    return new Promise(resolve => this.watchers.push({ test, resolve }));
  }

  /** The next `textDocument/publishDiagnostics` about `path`. */
  diagnostics(path: string) {
    const uri = uriOf(path);
    return this.notification(it => it.method === "textDocument/publishDiagnostics" && it.params.uri === uri);
  }

  /** Closes the client's side and waits for the server to end. */
  async end() {
    this.proc.stdin.end();
    const [exitCode, stderr] = await Promise.all([this.proc.exited, this.stderr]);
    await this.done;
    return { exitCode, stderr, garbage: this.framer.garbage, rest: this.framer.rest };
  }

  [Symbol.asyncDispose]() {
    this.proc.kill("SIGKILL");
    return this.done;
  }
}

const uriOf = (...parts: string[]) => Bun.pathToFileURL(join(...parts)).href;

const initialize = (client: Client, folders: string[], more: object = {}) =>
  client.request("initialize", {
    processId: process.pid,
    capabilities: {},
    workspaceFolders: folders.map(it => ({ uri: uriOf(it), name: it })),
    ...more,
  });

const open = (client: Client, path: string, text: string, languageId = "javascript") =>
  client.notify("textDocument/didOpen", { textDocument: { uri: uriOf(path), languageId, version: 1, text } });

const format = (client: Client, path: string) =>
  client.request("textDocument/formatting", {
    textDocument: { uri: uriOf(path) },
    options: { tabSize: 2, insertSpaces: true },
  });

/** `text` with the `TextEdit`s applied. Positions count UTF-16 code units, which are bytes in these tests. */
function applyEdits(text: string, edits: TextEdit[]) {
  const starts = [0];
  for (let at = 0; at < text.length; at++) if (text[at] === "\n") starts.push(at + 1);
  const offset = ({ line, character }: Position) => (line < starts.length ? starts[line] + character : text.length);
  const ordered = [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start));
  for (const edit of ordered) {
    text = text.slice(0, offset(edit.range.start)) + edit.newText + text.slice(offset(edit.range.end));
  }
  return text;
}

const oxlintrc = (config: object) =>
  JSON.stringify({ categories: { correctness: "off" }, ignorePatterns: ["plugin.mjs"], ...config });

const noDebugger = {
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } },
  severity: 1,
  code: "no-debugger",
  source: "bun",
  message: "Unexpected 'debugger' statement.",
};

describe.skipIf(!hasRunner).concurrent("bun lint --lsp", () => {
  test(
    "answers initialize with the capabilities of a linter and a formatter",
    async () => {
      using dir = tempDir("bun-lint-lsp", {});
      await using client = new Client(String(dir));
      const { result, error } = await initialize(client, [String(dir)]);
      expect(error).toBeUndefined();
      expect(result.serverInfo).toEqual({ name: "bun", version: expect.stringMatching(/^\d+\.\d+\.\d+/) });
      expect(result.capabilities).toEqual({
        positionEncoding: "utf-16",
        textDocumentSync: { openClose: true, change: 2, save: true },
        codeActionProvider: { codeActionKinds: ["quickfix", "source.fixAll.bun"] },
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
        workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
      });
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "publishes the problems of an open document with the bunfig.toml of its folder, and follows its changes",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        "a/bunfig.toml": '[lint.rules]\n"no-debugger" = "off"\n',
        "a/x.js": "",
        "b/y.js": "",
      });
      const a = join(String(dir), "a");
      const b = join(String(dir), "b");
      await using client = new Client(String(dir));
      expect((await initialize(client, [a, b])).error).toBeUndefined();
      client.notify("initialized");
      open(client, join(a, "x.js"), "debugger;\n");
      open(client, join(b, "y.js"), "debugger;\n");
      const [inA, inB] = await Promise.all([client.diagnostics(join(a, "x.js")), client.diagnostics(join(b, "y.js"))]);
      expect(inA.params).toEqual({ uri: uriOf(a, "x.js"), version: 1, diagnostics: [] });
      expect(inB.params).toEqual({
        uri: uriOf(b, "y.js"),
        version: 1,
        diagnostics: [{ ...noDebugger, codeDescription: { href: expect.any(String) } }],
      });

      // An incremental change: the first line becomes `1;`.
      client.notify("textDocument/didChange", {
        textDocument: { uri: uriOf(b, "y.js"), version: 2 },
        contentChanges: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } }, text: "1;" }],
      });
      const changed = await client.diagnostics(join(b, "y.js"));
      expect(changed.params).toEqual({ uri: uriOf(b, "y.js"), version: 2, diagnostics: [] });

      // Their problems are withdrawn when a document is closed.
      client.notify("textDocument/didClose", { textDocument: { uri: uriOf(b, "y.js") } });
      const closed = await client.diagnostics(join(b, "y.js"));
      expect(closed.params.diagnostics).toEqual([]);

      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "offers a quick fix and source.fixAll, and lints on save when not on every change",
    async () => {
      using dir = tempDir("bun-lint-lsp", { "bunfig.toml": '[lint.rules]\n"no-var" = "error"\n', "a.js": "" });
      await using client = new Client(String(dir));
      const started = await initialize(client, [String(dir)], {
        initializationOptions: { lint: { run: "onSave" } },
      });
      expect(started.error).toBeUndefined();
      client.notify("initialized");
      const text = "var a = 1;\nvar b = 2;\nconsole.log(a, b);\n";
      open(client, join(String(dir), "a.js"), text);
      const opened = await client.diagnostics(join(String(dir), "a.js"));
      expect(opened.params.diagnostics.map((it: any) => it.code)).toEqual(["no-var", "no-var"]);

      // Not on a change, on the save that follows it.
      client.notify("textDocument/didChange", {
        textDocument: { uri: uriOf(String(dir), "a.js"), version: 2 },
        contentChanges: [{ text: "var a = 1;\nlet b = 2;\nconsole.log(a, b);\n" }],
      });
      client.notify("textDocument/didSave", { textDocument: { uri: uriOf(String(dir), "a.js") } });
      const saved = await client.diagnostics(join(String(dir), "a.js"));
      expect(saved.params.version).toBe(2);
      expect(saved.params.diagnostics.map((it: any) => it.code)).toEqual(["no-var"]);

      const uri = uriOf(String(dir), "a.js");
      const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } };
      const actions = await client.request("textDocument/codeAction", {
        textDocument: { uri },
        range,
        context: { diagnostics: saved.params.diagnostics },
      });
      expect(actions.error).toBeUndefined();
      const editsOf = (action: any): TextEdit[] =>
        action.edit.changes?.[uri] ?? action.edit.documentChanges.find((it: any) => it.textDocument.uri === uri).edits;
      const quick = actions.result.find((it: any) => it.kind === "quickfix" && it.title === "Fix no-var");
      expect(applyEdits("var a = 1;\nlet b = 2;\nconsole.log(a, b);\n", editsOf(quick))).toBe(
        "let a = 1;\nlet b = 2;\nconsole.log(a, b);\n",
      );
      const all = await client.request("textDocument/codeAction", {
        textDocument: { uri },
        range,
        context: { diagnostics: [], only: ["source.fixAll"] },
      });
      expect(all.result.map((it: any) => it.kind)).toEqual(["source.fixAll.bun"]);
      expect(applyEdits("var a = 1;\nlet b = 2;\nconsole.log(a, b);\n", editsOf(all.result[0]))).toBe(
        "let a = 1;\nlet b = 2;\nconsole.log(a, b);\n",
      );
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "formats with [fmt] of the bunfig.toml of the folder",
    async () => {
      using dir = tempDir("bun-lint-lsp", { "bunfig.toml": "[fmt]\nsemi = false\n", "a.js": "" });
      await using client = new Client(String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const text = 'const  a  =  "a";\n';
      open(client, join(String(dir), "a.js"), text);
      const formatted = await format(client, join(String(dir), "a.js"));
      expect(formatted.error).toBeUndefined();
      expect(applyEdits(text, formatted.result)).toBe('const a = "a"\n');
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // Plugins run in a VM, which the server has only on Unix; there what else is printed is kept off the client's pipe.
  test.skipIf(isWindows)(
    "runs the plugins of the folder, keeps what they print off standard output, and ends their VM on exit",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/hello": "error" } }),
        "plugin.mjs": `
        import { writeSync } from "node:fs";
        process.on("exit", () => console.error("the plugin's exit handler ran"));
        export default {
          meta: { name: "demo" },
          rules: {
            hello: {
              create(context) {
                return {
                  Program(node) {
                    console.log("the plugin prints to stdout");
                    process.stdout.write("the plugin writes to process.stdout\\n");
                    writeSync(1, "the plugin writes to fd 1\\n");
                    console.error("the plugin prints to stderr");
                    context.report({ node, message: "hello from the plugin" });
                  },
                };
              },
            },
          },
        };`,
        "a.js": "",
      });
      await using client = new Client(String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      open(client, join(String(dir), "a.js"), "1;\n");
      const published = await client.diagnostics(join(String(dir), "a.js"));
      expect(published.params.diagnostics).toEqual([
        expect.objectContaining({ severity: 1, source: "bun", message: "hello from the plugin" }),
      ]);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, stderr, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(stderr).toContain("the plugin prints to stdout");
      expect(stderr).toContain("the plugin writes to process.stdout");
      expect(stderr).toContain("the plugin writes to fd 1");
      expect(stderr).toContain("the plugin prints to stderr");
      expect(stderr).toContain("the plugin's exit handler ran");
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "exits with 1 and prints no frame when standard input ends before initialize",
    async () => {
      using dir = tempDir("bun-lint-lsp", {});
      await using proc = spawn({ cmd: command, env: bunEnv, cwd: String(dir), stdin: "ignore", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "" });
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "refuses a request before initialize, and a method it does not have",
    async () => {
      using dir = tempDir("bun-lint-lsp", {});
      await using client = new Client(String(dir));
      expect((await client.request("shutdown")).error).toEqual({ code: -32002, message: expect.any(String) });
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      expect((await client.request("textDocument/hover")).error).toEqual({ code: -32601, message: expect.any(String) });
      // `exit` before `shutdown` is an error for the protocol.
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );
});
