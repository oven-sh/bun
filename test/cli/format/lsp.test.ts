// `bun fmt --no-script --lsp`: the language server over standard input and output, as an editor uses it.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";
import {
  applyEdits,
  Client,
  format,
  initialize,
  open,
  uriOf,
  type Message,
  type Position,
  type TextEdit,
} from "../lsp-client";

afterAll(endChildren);

const command = [bunExe(), "fmt", "--no-script", "--lsp"];

// `bun lint` is compiled into debug and canary builds only: there the server lints too.
const lints = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

// Each test spawns a debug build and waits for initialize, a format and exit, which is seconds under ASAN; a Prettier
// plugin runs in a VM, which takes seconds more to start.
const timeout = isDebug || isASAN ? 120_000 : 10_000;

describe.concurrent("bun fmt --lsp", () => {
  test(
    "answers initialize with the capabilities of a formatter, and of a linter where the build has bun lint",
    async () => {
      using dir = tempDir("bun-fmt-lsp", { "a.js": "a;\n" });
      await using client = new Client(command, String(dir));
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
      await using client = new Client(command, String(dir));
      const { result } = await initialize(client, [String(dir)], {
        initializationOptions: { format: { enable: false } },
      });
      expect(result.capabilities.positionEncoding).toBe("utf-16");
      // The capability stays, so that the setting can come back on: the answers are empty while it is off.
      expect(result.capabilities.documentFormattingProvider).toBe(true);
      expect(result.capabilities.documentRangeFormattingProvider).toBe(true);
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
    "turns formatting on with workspace/didChangeConfiguration after starting with it off",
    async () => {
      using dir = tempDir("bun-fmt-lsp", { "a.js": "a;\n" });
      await using client = new Client(command, String(dir));
      await initialize(client, [String(dir)], {
        initializationOptions: { format: { enable: false } },
      });
      client.notify("initialized");
      const path = join(String(dir), "a.js");
      const text = "a  ;\n";
      open(client, path, text);
      expect((await format(client, path)).result).toBeNull();
      client.notify("workspace/didChangeConfiguration", { settings: { bun: { format: { enable: true } } } });
      const formatted = await format(client, path);
      expect(formatted.error).toBeUndefined();
      expect(applyEdits(text, formatted.result)).toBe("a;\n");
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // Turning linting on is a setting of the editor, not a configuration of the folder: the folder's VMs keep their
  // threads, whose ids are those of the tasks in /proc.
  test(
    "turns linting on with workspace/didChangeConfiguration after starting with it off, with the same VMs",
    async () => {
      using dir = tempDir("bun-fmt-lsp", {
        "node_modules/prettier/package.json": '{ "name": "prettier", "version": "3.0.0", "main": "index.cjs" }',
        "node_modules/prettier/index.cjs": `exports.resolveConfig = async () => null;
exports.format = async (text, options) => text.replace(/ +/g, " ");
`,
        "node_modules/prettier-plugin-astro/package.json": '{ "name": "prettier-plugin-astro", "version": "4.0.0" }',
        ".prettierrc": '{ "plugins": ["prettier-plugin-astro"] }\n',
        "a.astro": "",
        "a.js": "a;\n",
      });
      await using client = new Client(command, String(dir));
      const { result } = await initialize(client, [String(dir)], {
        initializationOptions: { lint: { enable: false } },
      });
      expect(result.capabilities.codeActionProvider).toEqual(
        lints ? { codeActionKinds: ["quickfix", "source.fixAll.bun"] } : false,
      );
      client.notify("initialized");
      const path = join(String(dir), "a.js");
      open(client, path, "debugger;\n");
      const astro = join(String(dir), "a.astro");
      const text = "<p   >a</p>\n";
      const vmThreadIds = () => {
        const tasks = `/proc/${client.proc.pid}/task`;
        return readdirSync(tasks)
          .filter(task => {
            try {
              return readFileSync(join(tasks, task, "comm"), "utf8").startsWith("Bun Lint JS");
            } catch {
              return false;
            }
          })
          .sort();
      };
      let ids: string[] = [];
      if (isLinux) {
        open(client, astro, text, "astro");
        const first = await format(client, astro);
        expect(first.error).toBeUndefined();
        expect(applyEdits(text, first.result)).toBe("<p >a</p>\n");
        ids = vmThreadIds();
        expect(ids.length).toBeGreaterThan(0);
      }
      client.notify("workspace/didChangeConfiguration", { settings: { bun: { lint: { enable: true } } } });
      if (lints) {
        const published = await client.diagnostics(path);
        expect(published.params.diagnostics.map((it: any) => it.code)).toEqual(["no-debugger"]);
      }
      if (isLinux) {
        const again = await format(client, astro);
        expect(again.error).toBeUndefined();
        expect(applyEdits(text, again.result)).toBe("<p >a</p>\n");
        expect(vmThreadIds()).toEqual(ids);
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
    "turns linting off with the initialization options, whatever the build has",
    async () => {
      using dir = tempDir("bun-fmt-lsp", { "a.js": "a;\n" });
      await using client = new Client(command, String(dir));
      const { result } = await initialize(client, [String(dir)], {
        initializationOptions: { lint: { enable: false } },
      });
      expect(result.capabilities.codeActionProvider).toEqual(
        lints ? { codeActionKinds: ["quickfix", "source.fixAll.bun"] } : false,
      );
      expect(result.capabilities.documentFormattingProvider).toBe(true);
      client.notify("initialized");
      const path = join(String(dir), "a.js");
      open(client, path, "debugger;\n");
      // The thread of the folder answers this after whatever it was asked before.
      expect((await format(client, path)).result).toEqual([]);
      const actions = await client.request("textDocument/codeAction", {
        textDocument: { uri: uriOf(path) },
        range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
        context: { diagnostics: [] },
      });
      expect(actions.result).toEqual([]);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      const diagnostics = client.received.filter(it => it.method === "textDocument/publishDiagnostics");
      expect(diagnostics.filter(it => it.params.diagnostics.length > 0)).toEqual([]);
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // Bun's own `--config=` is relative to where the server started, as it is for `bun fmt`, not to each folder.
  test(
    "reads the bunfig.toml that bun's --config= names from where the server started",
    async () => {
      using dir = tempDir("bun-fmt-lsp", {
        "editor.toml": "[fmt]\nsemi = false\n",
        "a/bunfig.toml": "[fmt]\nsingleQuote = true\n",
        "a/x.js": "",
      });
      const a = join(String(dir), "a");
      await using client = new Client([bunExe(), "--config=editor.toml", "fmt", "--no-script", "--lsp"], String(dir));
      expect((await initialize(client, [a])).error).toBeUndefined();
      client.notify("initialized");
      const ugly = 'const  value  =  "text"\n';
      open(client, join(a, "x.js"), ugly);
      const formatted = await format(client, join(a, "x.js"));
      expect(formatted.error).toBeUndefined();
      expect(applyEdits(ugly, formatted.result)).toBe('const value = "text"\n');
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([]);
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
      await using client = new Client(command, String(dir));
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

  // A configuration file that is a program runs in a child process: once per folder, not once per request, which
  // would miss the editor's timeout for formatting on save.
  test(
    "evaluates a prettier.config.js once per generation, not per formatting request",
    async () => {
      using dir = tempDir("bun-fmt-lsp", {
        "prettier.config.js": `require("node:fs").appendFileSync(require("node:path").join(__dirname, "evaluated.txt"), "x\\n");
module.exports = { semi: false };
`,
        "package.json": "{}",
        "a.js": "a;\n",
      });
      const evaluations = () =>
        existsSync(join(String(dir), "evaluated.txt"))
          ? readFileSync(join(String(dir), "evaluated.txt"), "utf8")
              .split("\n")
              .filter(Boolean).length
          : 0;
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.js");
      open(client, path, "a;\n");
      for (let request = 0; request < 5; request++) {
        const formatted = await format(client, path);
        expect(formatted.error).toBeUndefined();
        expect(applyEdits("a;\n", formatted.result)).toBe("a\n");
      }
      expect(evaluations()).toBe(1);

      // A change of the file is read again.
      client.notify("workspace/didChangeWatchedFiles", {
        changes: [{ uri: uriOf(String(dir), "prettier.config.js"), type: 2 }],
      });
      const again = await format(client, path);
      expect(again.error).toBeUndefined();
      expect(applyEdits("a;\n", again.result)).toBe("a\n");
      expect(evaluations()).toBe(2);

      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([]);
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

      await using client = new Client(command, String(dir));
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
      await using client = new Client(command, String(dir));
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
      await using client = new Client(command, String(dir));
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

  // The same redaction as `bun install` prints for a bunfig.toml that does not parse.
  test(
    "shows a syntax error of bunfig.toml without repeating its text, which may be a secret",
    async () => {
      const token = "npm_abcdefghijklmnopqrstuvwxyz0123456789";
      using dir = tempDir("bun-fmt-lsp", {
        "bunfig.toml": `[install]\ntoken = ${token}\n`,
        "a.js": "",
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      open(client, join(String(dir), "a.js"), "a  ;\n");
      const shown = client.notification(it => it.method === "window/showMessage");
      const formatted = await format(client, join(String(dir), "a.js"));
      expect(formatted.error).toBeUndefined();
      expect(formatted.result).toBeNull();
      const { params } = await shown;
      expect(params.type).toBe(1);
      expect(params.message).toMatch(/Cannot use bunfig\.toml:2:\d+: Strings must be quoted$/);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, stderr, garbage, rest } = await client.end();
      const messages = client.received.filter(it => it.method === "window/showMessage").map(it => it.params.message);
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) expect(message).not.toContain(token);
      expect(stderr).not.toContain(token);
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // The prefix names the half that failed, not the command that started the server: `bun fmt --lsp` lints too where
  // the build has `bun lint`, and `bun lint` reads `[fmt]` as well. Each half reports the same `bunfig.toml` once,
  // under its own name.
  test(
    "shows a bunfig.toml that bun fmt cannot use as an error of bun fmt, once",
    async () => {
      using dir = tempDir("bun-fmt-lsp", { "bunfig.toml": "[fmt]\nsem = false\n", "a.js": "" });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      open(client, join(String(dir), "a.js"), "a  ;\n");
      const shown = client.notification(
        it => it.method === "window/showMessage" && it.params.message.startsWith("bun fmt: "),
      );
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
      expect(messages.filter(it => it.startsWith("bun lint: "))).toEqual(
        lints ? [expect.stringMatching(/^bun lint: Cannot use bunfig\.toml:2:1: Unknown key "sem" in \[fmt\]/)] : [],
      );
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // A failure of the setup is the same for every request, so the user sees it once. A syntax error is about the one
  // text and is logged each time.
  test(
    "shows a configuration file that cannot be loaded once, however many requests fail on it",
    async () => {
      using dir = tempDir("bun-fmt-lsp", { ".prettierrc": '{ "semi": \n', "a.js": "" });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      open(client, join(String(dir), "a.js"), "a  ;\n");
      const told = () =>
        client.received
          .filter(it => it.method === "window/showMessage" || it.method === "window/logMessage")
          .map(it => [it.method, it.params.type, it.params.message]);
      const first = await format(client, join(String(dir), "a.js"));
      expect(first).toMatchObject({ result: null });
      expect(first.error).toBeUndefined();
      expect(told()).toEqual([
        [
          "window/showMessage",
          1,
          expect.stringMatching(/^bun fmt: Cannot load the configuration file .*[\\/]\.prettierrc:\n/),
        ],
      ]);
      const second = await format(client, join(String(dir), "a.js"));
      expect(second).toMatchObject({ result: null });
      expect(second.error).toBeUndefined();
      expect(told()).toHaveLength(1);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect(told()).toHaveLength(1);
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // `--parser` names the file's parser, as with `--stdin-filepath`: an unknown one is refused when the server starts
  // formatting, not passed over for every file.
  test(
    "refuses an unknown --parser once, as bun fmt --stdin-filepath does",
    async () => {
      using dir = tempDir("bun-fmt-lsp", { "a.js": "" });
      await using client = new Client([...command, "--parser=nope"], String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      open(client, join(String(dir), "a.js"), "a  ;\n");
      const told = () =>
        client.received
          .filter(it => it.method === "window/showMessage" || it.method === "window/logMessage")
          .map(it => [it.method, it.params.type, it.params.message]);
      const first = await format(client, join(String(dir), "a.js"));
      expect(first).toMatchObject({ result: null });
      expect(first.error).toBeUndefined();
      expect(told()).toEqual([["window/showMessage", 1, `bun fmt: Couldn't resolve parser "nope".`]]);
      const second = await format(client, join(String(dir), "a.js"));
      expect(second).toMatchObject({ result: null });
      expect(second.error).toBeUndefined();
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect(told()).toHaveLength(1);
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // The editor registers the formatter for TOML too, and Prettier has no parser for it: that is about the one file,
  // not the folder, so it is logged and the rest of the folder still formats.
  test(
    "logs a file that has no parser instead of showing it, and formats the next file",
    async () => {
      using dir = tempDir("bun-fmt-lsp", {
        ".prettierrc": '{ "semi": false }\n',
        "bunfig.toml": "[install]\nexact = true\n",
        "a.js": "",
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const toml = join(String(dir), "bunfig.toml");
      open(client, toml, "[install]\nexact   = true\n", "toml");
      const told = () =>
        client.received
          .filter(it => it.method === "window/showMessage" || it.method === "window/logMessage")
          .map(it => [it.method, it.params.type, it.params.message]);
      const logged = () => told().filter(it => it[2].includes("No parser could be inferred for file"));
      const first = await format(client, toml);
      expect(first).toMatchObject({ result: null });
      expect(first.error).toBeUndefined();
      expect(logged()).toEqual([["window/logMessage", 2, expect.stringContaining("bunfig.toml")]]);
      const second = await format(client, toml);
      expect(second).toMatchObject({ result: null });
      expect(second.error).toBeUndefined();
      expect(logged()).toHaveLength(2);
      open(client, join(String(dir), "a.js"), "a;\n");
      const formatted = await format(client, join(String(dir), "a.js"));
      expect(formatted.error).toBeUndefined();
      expect(applyEdits("a;\n", formatted.result)).toBe("a\n");
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect(told().filter(it => it[0] === "window/showMessage")).toEqual([]);
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "refuses a second initialize, and answers a cancelled request with RequestCancelled",
    async () => {
      using dir = tempDir("bun-fmt-lsp", { "a.js": "" });
      await using client = new Client(command, String(dir));
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

  test(
    "cancels the requests of a workspace folder that is removed, and formats its files with the defaults afterwards",
    async () => {
      using dir = tempDir("bun-fmt-lsp", {
        "a/bunfig.toml": "[fmt]\nsemi = false\n",
        "a/x.js": "",
        "c/y.js": "",
      });
      const a = join(String(dir), "a");
      const c = join(String(dir), "c");
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [a, c])).error).toBeUndefined();
      client.notify("initialized");
      const ugly = 'const  value  =  "text"\n';
      open(client, join(a, "x.js"), ugly);
      // The folder's thread may be on the first request when the reader takes the second and the removal of the folder.
      let first!: Promise<Message>, second!: Promise<Message>;
      client.together(() => {
        first = format(client, join(a, "x.js"));
        second = format(client, join(a, "x.js"));
        client.notify("workspace/didChangeWorkspaceFolders", {
          event: { added: [], removed: [{ uri: uriOf(a), name: a }] },
        });
      });
      const before = await first;
      expect([undefined, -32800]).toContain(before.error?.code);
      if (before.error === undefined) expect(applyEdits(ugly, before.result)).toBe('const value = "text"\n');
      expect((await second).error).toEqual({ code: -32800, message: expect.any(String) });
      // Out of every folder, the file is formatted without a/bunfig.toml.
      const after = await format(client, join(a, "x.js"));
      expect(after.error).toBeUndefined();
      expect(applyEdits(ugly, after.result)).toBe('const value = "text";\n');
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
      await using client = new Client(command, String(dir));
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

  // A setting of the editor is not a configuration of the folder: the VMs keep their threads, whose ids are those of
  // the tasks in /proc.
  test.skipIf(!isLinux)(
    "keeps the threads of a folder's VMs when the settings of the editor change",
    async () => {
      using dir = tempDir("bun-fmt-lsp", {
        "node_modules/prettier/package.json": '{ "name": "prettier", "version": "3.0.0", "main": "index.cjs" }',
        "node_modules/prettier/index.cjs": `exports.resolveConfig = async () => null;
exports.format = async (text, options) => text.replace(/ +/g, " ");
`,
        "node_modules/prettier-plugin-astro/package.json": '{ "name": "prettier-plugin-astro", "version": "4.0.0" }',
        ".prettierrc": '{ "plugins": ["prettier-plugin-astro"] }\n',
        "a.astro": "",
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const text = "<p   >a</p>\n";
      open(client, join(String(dir), "a.astro"), text, "astro");
      const vmThreadIds = () => {
        const tasks = `/proc/${client.proc.pid}/task`;
        return readdirSync(tasks)
          .filter(task => {
            try {
              return readFileSync(join(tasks, task, "comm"), "utf8").startsWith("Bun Lint JS");
            } catch {
              return false;
            }
          })
          .sort();
      };
      const first = await format(client, join(String(dir), "a.astro"));
      expect(first.error).toBeUndefined();
      expect(applyEdits(text, first.result)).toBe("<p >a</p>\n");
      const ids = vmThreadIds();
      expect(ids.length).toBeGreaterThan(0);
      for (let change = 1; change <= 5; change++) {
        client.notify("workspace/didChangeConfiguration", { settings: { bun: { lint: { run: "onSave" } } } });
        const formatted = await format(client, join(String(dir), "a.astro"));
        expect(formatted.error).toBeUndefined();
        expect(applyEdits(text, formatted.result)).toBe("<p >a</p>\n");
        expect(vmThreadIds()).toEqual(ids);
      }
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test.each([
    ["--init", "--init"],
    ["--write", "--write"],
    ["--staged", "--staged or --changed"],
    ["--cwd=.", "--cwd"],
    ["a.js", "Files"],
  ])(
    "refuses %s with --lsp, and writes nothing",
    async (arg, named) => {
      using dir = tempDir("bun-fmt-lsp", { "a.js": "a ;\n" });
      await using proc = spawn({
        cmd: [...command, arg],
        env: bunEnv,
        cwd: String(dir),
        stdin: "ignore",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("");
      expect(stderr).toContain(`${named} cannot be used with --lsp`);
      expect(existsSync(join(String(dir), "bunfig.toml"))).toBe(false);
      expect(readFileSync(join(String(dir), "a.js"), "utf8")).toBe("a ;\n");
      expect(exitCode).toBe(2);
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
      await using early = new Client(command, String(dir));
      const refused = await early.request("shutdown");
      expect(refused.error).toEqual({ code: -32002, message: expect.any(String) });
      expect((await initialize(early, [String(dir)])).error).toBeUndefined();
      const gone = await early.end();
      expect([gone.garbage, gone.rest]).toEqual([[], ""]);
      expect(gone.exitCode).toBe(1);

      await using without = new Client(command, String(dir));
      await initialize(without, [String(dir)]);
      without.notify("exit");
      expect((await without.end()).exitCode).toBe(1);
    },
    timeout,
  );

  // Editors pass these to every language server; without `--lsp` they are unknown flags.
  test(
    "accepts --stdio and --clientProcessId with --lsp, and only there",
    async () => {
      using dir = tempDir("bun-fmt-lsp", {});
      await using client = new Client([...command, "--stdio", "--clientProcessId=1"], String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);

      await using refused = spawn({
        cmd: [bunExe(), "fmt", "--no-script", "--stdio", "--clientProcessId=1"],
        env: bunEnv,
        cwd: String(dir),
        stdin: "ignore",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([refused.stdout.text(), refused.stderr.text(), refused.exited]);
      expect(out).toBe("");
      expect(err).toContain("Invalid option '--stdio'");
      expect(code).toBe(2);
    },
    timeout,
  );

  // After an emoji on its line, a `character` differs between the encodings: the emoji is two code units and four
  // bytes. Three of them put a range counted in the wrong encoding on the statement before or after the right one.
  test.each([
    ["utf-8", { general: { positionEncodings: ["utf-8"] } }],
    ["utf-16", {}],
  ] as const)(
    "counts the positions of a range and of a change in %s, as negotiated",
    async (encoding, capabilities) => {
      using dir = tempDir("bun-fmt-lsp", { "a.js": "" });
      const line = '"😀😀😀"; a  ; b  ; c  ;';
      const text = `x  ;\n${line}\n`;
      // `bun fmt` counts `--range-start` in UTF-16 code units, as Prettier does, whatever the client counts.
      const cli = async (text: string, statement?: string) => {
        const range = statement
          ? [`--range-start=${text.indexOf(statement)}`, `--range-end=${text.indexOf(statement) + statement.length}`]
          : [];
        await using proc = spawn({
          cmd: [bunExe(), "fmt", "--no-script", ...range, "--stdin-filepath", "a.js"],
          env: bunEnv,
          cwd: String(dir),
          stdin: Buffer.from(text),
          stderr: "pipe",
        });
        const [formatted, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        expect(exitCode).toBe(0);
        expect(formatted).not.toBe(text);
        return formatted;
      };
      const rangeOf = (statement: string) => {
        const character = (at: number) => (encoding === "utf-8" ? Buffer.byteLength(line.slice(0, at)) : at);
        const start = line.indexOf(statement);
        return {
          start: { line: 1, character: character(start) },
          end: { line: 1, character: character(start + statement.length) },
        };
      };
      const apply = encoding === "utf-8" ? applyByteEdits : applyEdits;

      const expected = await cli(text, "b  ;");
      expect(expected).toContain("a  ; b; c  ;");
      await using client = new Client(command, String(dir));
      const { result } = await initialize(client, [String(dir)], { capabilities });
      expect(result.capabilities.positionEncoding).toBe(encoding);
      client.notify("initialized");
      open(client, join(String(dir), "a.js"), text);
      const ranged = await client.request("textDocument/rangeFormatting", {
        textDocument: { uri: uriOf(String(dir), "a.js") },
        range: rangeOf("b  ;"),
        options: { tabSize: 2, insertSpaces: true },
      });
      expect(ranged.error).toBeUndefined();
      expect(apply(text, ranged.result)).toBe(expected);

      // An incremental change of the same statement, then the document is formatted as the changed text is.
      const changed = text.replace("b  ;", "bb  ;");
      client.notify("textDocument/didChange", {
        textDocument: { uri: uriOf(String(dir), "a.js"), version: 2 },
        contentChanges: [{ range: rangeOf("b  ;"), text: "bb  ;" }],
      });
      const expectedChanged = await cli(changed);
      expect(expectedChanged).toContain("a;\nbb;\nc;\n");
      const formatted = await format(client, join(String(dir), "a.js"));
      expect(formatted.error).toBeUndefined();
      expect(apply(changed, formatted.result)).toBe(expectedChanged);

      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );
});

/** `applyEdits` for positions that count bytes. */
function applyByteEdits(text: string, edits: TextEdit[]) {
  let bytes = Buffer.from(text);
  const starts = [0];
  for (let at = 0; at < bytes.length; at++) if (bytes[at] === 0x0a) starts.push(at + 1);
  const offset = ({ line, character }: Position) => (line < starts.length ? starts[line] + character : bytes.length);
  const ordered = [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start));
  for (const edit of ordered) {
    const [start, end] = [offset(edit.range.start), offset(edit.range.end)];
    bytes = Buffer.concat([bytes.subarray(0, start), Buffer.from(edit.newText), bytes.subarray(end)]);
  }
  return bytes.toString();
}

// How the command line gets to the server: `bun lint --no-script --lsp` is a server in a build that has `bun lint`,
// `bun fmt --no-script --lsp` in every build, and without `--no-script` either goes to a script of the project.
describe.concurrent("bun fmt --lsp dispatch", () => {
  // Its stdin is closed here, which ends the server before `initialize` with nothing on stdout: as a release build's
  // `bun lint` ends without a script.
  test(
    "elsewhere bun lint --lsp is refused like bun lint",
    async () => {
      using dir = tempDir("bun-lint-lsp-canary-only", { "package.json": "{}" });
      await using proc = spawn({
        cmd: [bunExe(), "lint", "--lsp"],
        env: bunEnv,
        cwd: String(dir),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("");
      if (!lints) expect(stderr).toBe('error: Script not found "lint"\n');
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // `--lsp` is not a flag that asks the command about itself, so without `--no-script` it goes to the script.
  test.each([
    ["lint", `{ "scripts": { "lint": "echo the script" } }`],
    ["fmt", `{ "scripts": { "fmt": "echo the script" } }`],
  ])(
    "everywhere bun %s --lsp runs a script of the project",
    async (command, packageJson) => {
      using dir = tempDir("bun-lsp-of-the-project", { "package.json": packageJson });
      await using proc = spawn({
        cmd: [bunExe(), command, "--lsp"],
        env: bunEnv,
        cwd: String(dir),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.trim()).toBe("the script --lsp");
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "everywhere bun fmt --no-script --lsp formats, and lints where the build has bun lint",
    async () => {
      using dir = tempDir("bun-fmt-lsp-everywhere", {
        "bunfig.toml": `[lint.rules]\n"no-var" = "error"\n`,
        "a.js": "",
      });
      await using client = new Client(command, String(dir));
      // The older form of `initialize`: a root instead of workspace folders.
      const initialized = await client.request("initialize", {
        processId: null,
        rootUri: uriOf(String(dir)),
        capabilities: {},
      });
      expect(initialized.error).toBeUndefined();
      expect(initialized.result.serverInfo.name).toBe("bun");
      // Formatting is on in every build. `bun lint` is compiled into debug and canary builds only.
      expect(initialized.result.capabilities).toMatchObject({
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
        codeActionProvider: lints ? { codeActionKinds: ["quickfix", "source.fixAll.bun"] } : false,
      });
      client.notify("initialized");
      // One line of ASCII, so a character is a code unit in either encoding.
      const text = "var a=1";
      open(client, join(String(dir), "a.js"), text);
      const formatted = await format(client, join(String(dir), "a.js"));
      expect(formatted.error).toBeUndefined();
      expect(applyEdits(text, formatted.result)).toBe("var a = 1;\n");
      // `bunfig.toml` turns `no-var` on: a fix to offer where the server lints, none where it does not.
      const actions = await client.request("textDocument/codeAction", {
        textDocument: { uri: uriOf(String(dir), "a.js") },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: text.length } },
        context: { diagnostics: [] },
      });
      expect(actions.error).toBeUndefined();
      if (lints)
        expect(actions.result).toContainEqual(expect.objectContaining({ kind: "quickfix", title: "Fix no-var" }));
      else expect(actions.result).toEqual([]);
      // The lint of `didOpen` is queued behind the requests: under load its diagnostics come after the code actions,
      // and `exit` would end the process before they are published.
      if (lints) {
        const published = await client.diagnostics(join(String(dir), "a.js"));
        expect(published.params.diagnostics.map((each: any) => each.code)).toContain("no-var");
      }
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      const published = client.received.filter(it => it.method === "textDocument/publishDiagnostics");
      const codes = published.flatMap(it => it.params.diagnostics.map((each: any) => each.code));
      if (lints) expect(codes).toContain("no-var");
      else expect(codes).toEqual([]);
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );
});
