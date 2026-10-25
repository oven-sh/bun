// `bun fmt --no-script --lsp`: the language server over standard input and output, as an editor uses it.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const command = [bunExe(), "fmt", "--no-script", "--lsp"];

// `bun lint` is compiled into debug and canary builds only: there the server lints too.
const lints = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

// Each test spawns a debug build and waits for initialize, a format and exit, which is seconds under ASAN; a Prettier
// plugin runs in a VM, which takes seconds more to start.
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

  /** What `send` has not written yet, while `together` runs. */
  private held: string[] | undefined;

  private send(message: object) {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    if (this.held) return void this.held.push(frame);
    this.proc.stdin.write(frame);
    this.proc.stdin.flush();
  }

  /** Sends what `send` is called with in `run` as one write. */
  together(run: () => void) {
    this.held = [];
    run();
    const frames = this.held.join("");
    this.held = undefined;
    this.proc.stdin.write(frames);
    this.proc.stdin.flush();
  }

  /** The id of the last request sent. */
  get lastId() {
    return this.next;
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

describe.concurrent("bun fmt --lsp", () => {
  test(
    "answers initialize with the capabilities of a formatter, and of a linter where the build has bun lint",
    async () => {
      using dir = tempDir("bun-fmt-lsp", { "a.js": "a;\n" });
      await using client = new Client(String(dir));
      const { result, error } = await initialize(client, [String(dir)], {
        capabilities: { general: { positionEncodings: ["utf-8", "utf-16"] } },
      });
      expect(error).toBeUndefined();
      expect(result.serverInfo.name).toBe("bun");
      expect(result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/);
      const { capabilities } = result;
      expect(capabilities.positionEncoding).toBe("utf-8");
      expect(capabilities.textDocumentSync).toEqual({ openClose: true, change: 2, save: true });
      expect(capabilities.documentFormattingProvider).toBe(true);
      expect(capabilities.documentRangeFormattingProvider).toBe(true);
      expect(capabilities.workspace.workspaceFolders).toEqual({ supported: true, changeNotifications: true });
      expect(capabilities.codeActionProvider).toEqual(
        lints ? { codeActionKinds: ["quickfix", "source.fixAll.bun"] } : false,
      );
      client.notify("initialized");
      open(client, join(String(dir), "a.js"), "debugger;\n");
      expect((await format(client, join(String(dir), "a.js"))).result).toEqual([]);
      if (lints) {
        const published = await client.notification(it => it.method === "textDocument/publishDiagnostics");
        expect(published.params.diagnostics.map((it: any) => it.code)).toEqual(["no-debugger"]);
      }
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      const diagnostics = client.received.filter(it => it.method === "textDocument/publishDiagnostics");
      expect(diagnostics.filter(it => it.params.diagnostics.length > 0)).toHaveLength(lints ? 1 : 0);
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "turns formatting off with the initialization options, and defaults to UTF-16 positions",
    async () => {
      using dir = tempDir("bun-fmt-lsp", { "a.js": "a;\n" });
      await using client = new Client(String(dir));
      const { result } = await initialize(client, [String(dir)], {
        initializationOptions: { format: { enable: false } },
      });
      expect(result.capabilities.positionEncoding).toBe("utf-16");
      expect(result.capabilities.documentFormattingProvider).toBe(false);
      expect(result.capabilities.documentRangeFormattingProvider).toBe(false);
      client.notify("initialized");
      open(client, join(String(dir), "a.js"), "a  ;\n");
      expect((await format(client, join(String(dir), "a.js"))).result).toBeNull();
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "formats each document with the bunfig.toml of its workspace folder, or of a directory above it",
    async () => {
      using dir = tempDir("bun-fmt-lsp", {
        "bunfig.toml": "[fmt]\nsingleQuote = true\n",
        "a/bunfig.toml": "[fmt]\nsemi = false\n",
        "a/x.js": "",
        "c/y.js": "",
      });
      const a = join(String(dir), "a");
      const c = join(String(dir), "c");
      await using client = new Client(String(dir));
      expect((await initialize(client, [a, c])).error).toBeUndefined();
      client.notify("initialized");
      const ugly = 'const  value  =  "text"\n';
      open(client, join(a, "x.js"), ugly);
      open(client, join(c, "y.js"), ugly);
      const [inA, inC] = await Promise.all([format(client, join(a, "x.js")), format(client, join(c, "y.js"))]);
      expect(inA.error).toBeUndefined();
      expect(inC.error).toBeUndefined();
      // The folder's own file is the only one that is read.
      expect(applyEdits(ugly, inA.result)).toBe('const value = "text"\n');
      expect(applyEdits(ugly, inC.result)).toBe("const value = 'text';\n");

      // When a configuration file changes, the next request uses the new one.
      writeFileSync(join(a, "bunfig.toml"), "[fmt]\nsemi = false\nsingleQuote = true\n");
      client.notify("workspace/didChangeWatchedFiles", {
        changes: [{ uri: uriOf(a, "bunfig.toml"), type: 2 }],
      });
      const again = await format(client, join(a, "x.js"));
      expect(applyEdits(ugly, again.result)).toBe("const value = 'text'\n");

      // A change of the document is what is formatted afterwards.
      client.notify("textDocument/didChange", {
        textDocument: { uri: uriOf(a, "x.js"), version: 2 },
        contentChanges: [{ text: "let  a  =  1\n" }],
      });
      const changed = await format(client, join(a, "x.js"));
      expect(applyEdits("let  a  =  1\n", changed.result)).toBe("let a = 1\n");

      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "formats a range as `bun fmt --range-start` does, and says so when a request is about no open document",
    async () => {
      using dir = tempDir("bun-fmt-lsp", { "a.js": "" });
      const text = "a  ;\nb  ;\nc  ;\n";
      // The second line.
      await using cli = spawn({
        cmd: [bunExe(), "fmt", "--no-script", "--range-start=5", "--range-end=9", "--stdin-filepath", "a.js"],
        env: bunEnv,
        cwd: String(dir),
        stdin: Buffer.from(text),
        stderr: "pipe",
      });
      const [expected, cliExitCode] = await Promise.all([cli.stdout.text(), cli.exited]);
      expect(cliExitCode).toBe(0);
      expect(expected).not.toBe(text);

      await using client = new Client(String(dir));
      await initialize(client, [String(dir)]);
      client.notify("initialized");
      open(client, join(String(dir), "a.js"), text);
      const ranged = await client.request("textDocument/rangeFormatting", {
        textDocument: { uri: uriOf(String(dir), "a.js") },
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
        options: { tabSize: 2, insertSpaces: true },
      });
      expect(ranged.error).toBeUndefined();
      expect(applyEdits(text, ranged.result)).toBe(expected);
      const unknown = await format(client, join(String(dir), "b.js"));
      expect(unknown.error?.code).toBe(-32602);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage } = await client.end();
      expect(garbage).toEqual([]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // Plugins run in a VM, which the server has only on Unix; there what else is printed is kept off the client's pipe.
  test.skipIf(isWindows)(
    "writes only frames to standard output: what a plugin prints goes to standard error",
    async () => {
      // A stand-in for Prettier and a plugin of it, as in format.test.ts. Its `format` collapses spaces and prints.
      using dir = tempDir("bun-fmt-lsp", {
        "node_modules/prettier/package.json": '{ "name": "prettier", "version": "3.0.0", "main": "index.cjs" }',
        "node_modules/prettier/index.cjs": `exports.resolveConfig = async () => null;
exports.format = async (text, options) => {
  console.log("plugin says hello on stdout");
  console.error("plugin says hello on stderr");
  return text.replace(/ +/g, " ");
};
`,
        "node_modules/prettier-plugin-astro/package.json": '{ "name": "prettier-plugin-astro", "version": "4.0.0" }',
        ".prettierrc": '{ "plugins": ["prettier-plugin-astro"] }\n',
        "a.astro": "",
      });
      await using client = new Client(String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const text = "<p   >a</p>\n";
      open(client, join(String(dir), "a.astro"), text, "astro");
      const formatted = await format(client, join(String(dir), "a.astro"));
      expect(formatted.error).toBeUndefined();
      expect(applyEdits(text, formatted.result)).toBe("<p >a</p>\n");
      // The same VM again.
      const again = await format(client, join(String(dir), "a.astro"));
      expect(applyEdits(text, again.result)).toBe("<p >a</p>\n");
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, stderr, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(stderr).toContain("plugin says hello on stdout");
      expect(stderr).toContain("plugin says hello on stderr");
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "answers null for a syntax error and for a file that --ignore-unknown skips, never with an edit",
    async () => {
      using dir = tempDir("bun-fmt-lsp", {
        "bunfig.toml": "[fmt]\nignoreUnknown = true\n",
        "a.js": "",
        "notes.zzz": "",
      });
      await using client = new Client(String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      open(client, join(String(dir), "a.js"), "const x  =  ;\n");
      const broken = await format(client, join(String(dir), "a.js"));
      expect(broken).toMatchObject({ result: null });
      expect(broken.error).toBeUndefined();
      // `bun fmt --stdin-filepath notes.zzz` prints nothing and exits with 0 here, which is not an empty document.
      open(client, join(String(dir), "notes.zzz"), "some   text\n", "plaintext");
      const unknown = await format(client, join(String(dir), "notes.zzz"));
      expect(unknown.error).toBeUndefined();
      expect(applyEdits("some   text\n", unknown.result ?? [])).toBe("some   text\n");
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // The prefix names the half that failed, not the command that started the server: `bun fmt --lsp` lints too where
  // the build has `bun lint`, and a `[fmt]` that `bun lint` would accept is still an error of `bun fmt`.
  test(
    "shows a bunfig.toml that bun fmt cannot use as an error of bun fmt, once",
    async () => {
      using dir = tempDir("bun-fmt-lsp", { "bunfig.toml": "[fmt]\nsem = false\n", "a.js": "" });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      open(client, join(String(dir), "a.js"), "a  ;\n");
      const shown = client.notification(it => it.method === "window/showMessage");
      const first = await format(client, join(String(dir), "a.js"));
      expect(first.error).toBeUndefined();
      expect(first.result).toBeNull();
      expect((await shown).params).toEqual({
        type: 1,
        message: expect.stringMatching(/^bun fmt: Cannot use bunfig\.toml:2:1: Unknown key "sem" in \[fmt\]/),
      });
      expect((await format(client, join(String(dir), "a.js"))).result).toBeNull();
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      const messages = client.received.filter(it => it.method === "window/showMessage").map(it => it.params.message);
      expect(messages.filter(it => it.startsWith("bun fmt: "))).toHaveLength(1);
      expect(messages.filter(it => it.startsWith("bun lint: "))).toEqual([]);
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "refuses a second initialize, and answers a cancelled request with RequestCancelled",
    async () => {
      using dir = tempDir("bun-fmt-lsp", { "a.js": "" });
      await using client = new Client(String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      expect((await initialize(client, [String(dir)])).error).toEqual({ code: -32600, message: expect.any(String) });
      client.notify("initialized");
      open(client, join(String(dir), "a.js"), "a  ;\n");
      // The folder's thread is on the first request while the reader takes the second and its cancellation.
      let first!: Promise<Message>, second!: Promise<Message>;
      client.together(() => {
        first = format(client, join(String(dir), "a.js"));
        second = format(client, join(String(dir), "a.js"));
        client.notify("$/cancelRequest", { id: client.lastId });
      });
      expect((await first).error).toBeUndefined();
      expect((await second).error).toEqual({ code: -32800, message: expect.any(String) });
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // Each change of a configuration file gives the folder a new set of VMs, and the old ones are freed with their
  // threads. Only the VM threads are counted: JSC starts helper threads of the process as it goes.
  test.skipIf(!isLinux)(
    "frees the threads of a folder's VMs when its configuration changes",
    async () => {
      using dir = tempDir("bun-fmt-lsp", {
        "node_modules/prettier/package.json": '{ "name": "prettier", "version": "3.0.0", "main": "index.cjs" }',
        "node_modules/prettier/index.cjs": `exports.resolveConfig = async () => null;
exports.format = async (text, options) => text.replace(/ +/g, " ");
`,
        "node_modules/prettier-plugin-astro/package.json": '{ "name": "prettier-plugin-astro", "version": "4.0.0" }',
        ".prettierrc": '{ "plugins": ["prettier-plugin-astro"] }\n',
        "bunfig.toml": "[fmt]\nprintWidth = 80\n",
        "a.astro": "",
      });
      await using client = new Client(String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const text = "<p   >a</p>\n";
      open(client, join(String(dir), "a.astro"), text, "astro");
      const vmThreads = () => {
        const tasks = `/proc/${client.proc.pid}/task`;
        return readdirSync(tasks).filter(task => {
          try {
            return readFileSync(join(tasks, task, "comm"), "utf8").startsWith("Bun Lint JS");
          } catch {
            return false;
          }
        }).length;
      };
      const counts: number[] = [];
      for (let generation = 1; generation <= 20; generation++) {
        writeFileSync(join(String(dir), "bunfig.toml"), `[fmt]\nprintWidth = ${80 + generation}\n`);
        client.notify("workspace/didChangeWatchedFiles", {
          changes: [{ uri: uriOf(String(dir), "bunfig.toml"), type: 2 }],
        });
        const formatted = await format(client, join(String(dir), "a.astro"));
        expect(formatted.error).toBeUndefined();
        expect(applyEdits(text, formatted.result)).toBe("<p >a</p>\n");
        counts.push(vmThreads());
      }
      expect(counts[0]).toBeGreaterThan(0);
      expect(counts[19]).toBe(counts[0]);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "exits with 1 and prints no frame when standard input ends before initialize",
    async () => {
      using dir = tempDir("bun-fmt-lsp", {});
      await using proc = spawn({ cmd: command, env: bunEnv, cwd: String(dir), stdin: "ignore", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "" });
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "exits with 1 when the client goes away after initialize, and refuses a request before it",
    async () => {
      using dir = tempDir("bun-fmt-lsp", {});
      await using early = new Client(String(dir));
      const refused = await early.request("shutdown");
      expect(refused.error).toEqual({ code: -32002, message: expect.any(String) });
      expect((await initialize(early, [String(dir)])).error).toBeUndefined();
      const gone = await early.end();
      expect([gone.garbage, gone.rest]).toEqual([[], ""]);
      expect(gone.exitCode).toBe(1);

      await using without = new Client(String(dir));
      await initialize(without, [String(dir)]);
      without.notify("exit");
      expect((await without.end()).exitCode).toBe(1);
    },
    timeout,
  );
});
