// `bun lint --no-script --lsp`: the language server over standard input and output, as an editor uses it. It lints and formats.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";
import { applyEdits, Client, format, initialize, open, uriOf, type Message, type TextEdit } from "../lsp-client";

afterAll(endChildren);

const command = [bunExe(), "lint", "--no-script", "--lsp"];

// Each test spawns a debug build and waits for initialize, a lint or format and exit, which is seconds under ASAN; a
// JavaScript plugin runs in a VM, which takes seconds more to start.
const timeout = isDebug || isASAN ? 120_000 : 10_000;

const oxlintrc = (config: object) =>
  JSON.stringify({ categories: { correctness: "off" }, ignorePatterns: ["plugin.mjs"], ...config });

const noDebugger = {
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } },
  severity: 1,
  code: "no-debugger",
  source: "bun",
  message: "Unexpected 'debugger' statement.",
};

// A plugin whose rule `demo/hold` holds the second lint that it is part of until a file called `release` is next to
// it, and writes `held` when it does. After a document is opened, that is its lint with types. The other lints of
// the engine wait for the plugin too.
const holdsSecondLint = `
  import { appendFileSync, existsSync, statSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  const at = name => join(import.meta.dirname, name);
  export default {
    meta: { name: "demo" },
    rules: {
      hold: {
        create() {
          return {
            Program() {
              appendFileSync(at("calls"), "x");
              if (statSync(at("calls")).size !== 2) return;
              writeFileSync(at("held"), "");
              while (!existsSync(at("release"))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
            },
          };
        },
      },
    },
  };`;

describe.concurrent("bun lint --lsp", () => {
  test(
    "answers initialize with the capabilities of a linter and a formatter",
    async () => {
      using dir = tempDir("bun-lint-lsp", {});
      await using client = new Client(command, String(dir));
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
      await using client = new Client(command, String(dir));
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
      await using client = new Client(command, String(dir));
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
    "answers the same source.fixAll to the same request twice on one version of a document",
    async () => {
      using dir = tempDir("bun-lint-lsp", { "bunfig.toml": '[lint.rules]\n"no-var" = "error"\n', "a.js": "" });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const text = "var a = 1;\nvar b = 2;\nconsole.log(a, b);\n";
      open(client, join(String(dir), "a.js"), text);
      const opened = await client.diagnostics(join(String(dir), "a.js"));
      expect(opened.params.diagnostics.map((it: any) => it.code)).toEqual(["no-var", "no-var"]);

      const uri = uriOf(String(dir), "a.js");
      const params = {
        textDocument: { uri },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: { diagnostics: [], only: ["source.fixAll"] },
      };
      const first = await client.request("textDocument/codeAction", params);
      const second = await client.request("textDocument/codeAction", params);
      expect(first.error).toBeUndefined();
      expect(first.result.map((it: any) => it.kind)).toEqual(["source.fixAll.bun"]);
      const editsOf = (action: any): TextEdit[] =>
        action.edit.changes?.[uri] ?? action.edit.documentChanges.find((it: any) => it.textDocument.uri === uri).edits;
      expect(applyEdits(text, editsOf(first.result[0]))).toBe("let a = 1;\nlet b = 2;\nconsole.log(a, b);\n");
      expect(second.result).toEqual(first.result);

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
      await using client = new Client(command, String(dir));
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

  // import/no-cycle follows the imports of every file before it reports, and then lints the document a second time.
  test(
    "lints the editor's text, not the file's, when a rule looks at the other files first",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        ".oxlintrc.json": `{ "plugins": ["import"], "rules": { "import/no-cycle": "error" } }`,
        "src/a.js": `import "./b.js";\n`,
        "src/b.js": `export const b = 1;\n`,
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "src", "b.js");
      // In the editor b.js imports a.js, which closes a cycle. On disk it does not.
      open(client, path, `// not saved\nimport "./a.js";\n`);
      const published = await client.diagnostics(path);
      expect(published.params.diagnostics).toEqual([
        expect.objectContaining({
          code: "import/no-cycle",
          range: { start: { line: 1, character: 7 }, end: { line: 1, character: 15 } },
        }),
      ]);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "answers the requests of a workspace folder that is removed, and formats its files with the defaults afterwards",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
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
      // The folder's thread may answer either request before the reader takes the removal of the folder.
      let first!: Promise<Message>, second!: Promise<Message>;
      client.together(() => {
        first = format(client, join(a, "x.js"));
        second = format(client, join(a, "x.js"));
        client.notify("workspace/didChangeWorkspaceFolders", {
          event: { added: [], removed: [{ uri: uriOf(a), name: a }] },
        });
      });
      // Out of every folder, the file is formatted without a/bunfig.toml. The root that it is in then answers what
      // the thread of the folder has not answered.
      const [inFolder, inNone] = ['const value = "text"\n', 'const value = "text";\n'];
      for (const answer of [await first, await second]) {
        expect(answer.error).toBeUndefined();
        expect([inFolder, inNone]).toContain(applyEdits(ugly, answer.result));
      }
      const after = await format(client, join(a, "x.js"));
      expect(after.error).toBeUndefined();
      expect(applyEdits(ugly, after.result)).toBe(inNone);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // An eslint.config.mjs is read in the plugins' VM, which the server has only on Unix.
  test.skipIf(isWindows)(
    "writes the disable comment in the language of the document, and none where the language has no comments",
    async () => {
      const standIn = (name: string, languages: string[], rules: string[]) => `
        const language = { parse: ({ body }) => ({ ok: true, ast: { lines: body.split("\\n") } }) };
        const rule = { create: context => ({ Line: () => context.report({ line: 1, message: "the package" }) }) };
        module.exports = {
          meta: { name: ${JSON.stringify(name)}, version: "1.0.0" },
          languages: Object.fromEntries(${JSON.stringify(languages)}.map(name => [name, language])),
          rules: Object.fromEntries(${JSON.stringify(rules)}.map(name => [name, rule])),
        };`;
      using dir = tempDir("bun-lint-lsp", {
        "node_modules/@eslint/markdown/package.json": JSON.stringify({
          name: "@eslint/markdown",
          version: "8.0.3",
          main: "index.js",
        }),
        "node_modules/@eslint/markdown/index.js": standIn("@eslint/markdown", ["commonmark", "gfm"], ["no-html"]),
        "node_modules/@eslint/json/package.json": JSON.stringify({
          name: "@eslint/json",
          version: "2.1.1",
          main: "index.js",
        }),
        "node_modules/@eslint/json/index.js": standIn("@eslint/json", ["json", "jsonc"], ["no-duplicate-keys"]),
        "eslint.config.mjs": `
          import markdown from "@eslint/markdown";
          import json from "@eslint/json";
          export default [
            {
              files: ["**/*.md"],
              plugins: { markdown },
              language: "markdown/gfm",
              languageOptions: { frontmatter: "yaml" },
              rules: { "markdown/no-html": "error" },
            },
            { files: ["**/*.json"], plugins: { json }, language: "json/json", rules: { "json/no-duplicate-keys": "error" } },
            { files: ["**/*.jsonc"], plugins: { json }, language: "json/jsonc", rules: { "json/no-duplicate-keys": "error" } },
          ];`,
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const disables = async (name: string, languageId: string, text: string) => {
        const path = join(String(dir), name);
        open(client, path, text, languageId);
        const published = await client.diagnostics(path);
        expect(published.params.diagnostics).toHaveLength(1);
        const [diagnostic] = published.params.diagnostics;
        const actions = await client.request("textDocument/codeAction", {
          textDocument: { uri: uriOf(path) },
          range: diagnostic.range,
          context: { diagnostics: [diagnostic] },
        });
        expect(actions.error).toBeUndefined();
        const edited = (title: string) => {
          const action = actions.result.find((it: any) => it.title === title);
          return action === undefined ? undefined : applyEdits(text, action.edit.changes[uriOf(path)]);
        };
        return {
          code: diagnostic.code,
          line: edited(`Disable ${diagnostic.code} for this line`),
          file: edited(`Disable ${diagnostic.code} for this file`),
        };
      };
      expect(await disables("a.md", "markdown", "# Title\n\n<b>a</b>\n")).toEqual({
        code: "markdown/no-html",
        line: "# Title\n\n<!-- eslint-disable-next-line markdown/no-html -->\n<b>a</b>\n",
        file: "<!-- eslint-disable markdown/no-html -->\n# Title\n\n<b>a</b>\n",
      });
      // The comment goes after the front matter, which must stay first.
      const withFrontMatter = await disables("fm.md", "markdown", "---\ntitle: x\n---\n\n# Title\n\n<b>a</b>\n");
      expect(withFrontMatter).toEqual({
        code: "markdown/no-html",
        line: "---\ntitle: x\n---\n\n# Title\n\n<!-- eslint-disable-next-line markdown/no-html -->\n<b>a</b>\n",
        file: "---\ntitle: x\n---\n<!-- eslint-disable markdown/no-html -->\n\n# Title\n\n<b>a</b>\n",
      });
      client.notify("textDocument/didChange", {
        textDocument: { uri: uriOf(join(String(dir), "fm.md")), version: 2 },
        contentChanges: [{ text: withFrontMatter.file }],
      });
      expect((await client.diagnostics(join(String(dir), "fm.md"))).params.diagnostics).toHaveLength(0);
      const twice = '{ "a": 1, "a": 2 }\n';
      expect(await disables("a.jsonc", "jsonc", twice)).toEqual({
        code: "json/no-duplicate-keys",
        line: `// eslint-disable-next-line json/no-duplicate-keys\n${twice}`,
        file: `/* eslint-disable json/no-duplicate-keys */\n${twice}`,
      });
      expect(await disables("a.json", "json", twice)).toEqual({
        code: "json/no-duplicate-keys",
        line: undefined,
        file: undefined,
      });
      // The comment it wrote is one the linter reads.
      const commented = "# Title\n\n<!-- eslint-disable-next-line markdown/no-html -->\n<b>a</b>\n";
      client.notify("textDocument/didChange", {
        textDocument: { uri: uriOf(join(String(dir), "a.md")), version: 2 },
        contentChanges: [{ text: commented }],
      });
      const again = await client.diagnostics(join(String(dir), "a.md"));
      expect(again.params.diagnostics).toHaveLength(0);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // An eslint.config.mjs is read in the plugins' VM, which the server has only on Unix.
  test.skipIf(isWindows)(
    "tells the user about a document that needs eslint, which is not installed, and publishes no problem for it",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        "eslint.config.mjs": `export default [
          { rules: { "no-var": "error" } },
          { files: ["**/*.one"], plugins: { p: { languages: { l: {} } } }, language: "p/l" },
        ];`,
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const one = join(String(dir), "b.one");
      open(client, one, "text\n", "plaintext");
      const names = (it: Message) => it.method === "window/logMessage" && it.params.message.includes("b.one");
      expect((await client.notification(names)).params).toEqual({
        type: 2,
        message:
          "1 file was not linted because it needs eslint, which is not installed (1 *.one): b.one\n  Run bun add -d eslint",
      });
      // The folder's thread is past the first document once it has linted the second.
      const js = join(String(dir), "a.js");
      open(client, js, "var a = 1;\n");
      const published = await client.diagnostics(js);
      expect(published.params.diagnostics.map((it: any) => it.code)).toEqual(["no-var"]);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      // The document that is not linted is cleared once, in case an earlier generation had problems for it.
      const about = client.received.filter(it => it.method === "textDocument/publishDiagnostics");
      expect(about.map(it => [it.params.uri, it.params.diagnostics.length])).toEqual([
        [uriOf(one), 0],
        [uriOf(js), 1],
      ]);
      expect(client.received.filter(names)).toHaveLength(1);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "takes back the problems of a document once a configuration change makes it one not to lint",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        "bunfig.toml": '[lint.rules]\n"no-var" = "error"\n',
        "a.js": "",
        "b.js": "",
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const a = join(String(dir), "a.js");
      open(client, a, "var a = 1;\nconsole.log(a);\n");
      expect((await client.diagnostics(a)).params.diagnostics.map((it: any) => it.code)).toEqual(["no-var"]);

      await Bun.write(
        join(String(dir), "bunfig.toml"),
        '[lint]\nignorePatterns = ["a.js"]\n[lint.rules]\n"no-var" = "error"\n',
      );
      client.notify("workspace/didChangeWatchedFiles", {
        changes: [{ uri: uriOf(String(dir), "bunfig.toml"), type: 2 }],
      });
      expect((await client.diagnostics(a)).params).toEqual({ uri: uriOf(a), version: 1, diagnostics: [] });

      // Once: a change to the ignored document publishes nothing more. The folder's thread is past it once it has
      // linted the second document.
      client.notify("textDocument/didChange", {
        textDocument: { uri: uriOf(a), version: 2 },
        contentChanges: [{ text: "var b = 2;\nconsole.log(b);\n" }],
      });
      const b = join(String(dir), "b.js");
      open(client, b, "var b = 1;\nconsole.log(b);\n");
      expect((await client.diagnostics(b)).params.diagnostics.map((it: any) => it.code)).toEqual(["no-var"]);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      const aboutA = client.received.filter(
        it => it.method === "textDocument/publishDiagnostics" && it.params.uri === uriOf(a),
      );
      expect(aboutA.map(it => it.params.diagnostics.length)).toEqual([1, 0]);
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
      await using client = new Client(command, String(dir));
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

  // A plugin's realm keeps the numbers it was given for its rules and selectors: they must stay valid once a setting
  // has changed, which makes a new session with the same realm.
  test.skipIf(isWindows)(
    "keeps the plugins' diagnostics after a setting changes the session",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/hello": "error" } }),
        "plugin.mjs": `
        export default {
          meta: { name: "demo" },
          rules: {
            hello: {
              create(context) {
                return {
                  'Identifier[name="hello"]'(node) {
                    context.report({ node, message: "hello from the plugin" });
                  },
                };
              },
            },
          },
        };`,
        "a.js": "",
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.js");
      open(client, path, "hello;\n");
      const hello = [expect.objectContaining({ severity: 1, source: "bun", message: "hello from the plugin" })];
      expect((await client.diagnostics(path)).params.diagnostics).toEqual(hello);
      for (const enable of [false, true]) {
        client.notify("workspace/didChangeConfiguration", { settings: { bun: { format: { enable } } } });
        client.notify("textDocument/didChange", {
          textDocument: { uri: uriOf(path), version: enable ? 3 : 2 },
          contentChanges: [{ text: enable ? "hello;\n" : "hello; hello;\n" }],
        });
        const published = await client.diagnostics(path);
        expect(published.params.version).toBe(enable ? 3 : 2);
        expect(published.params.diagnostics).toEqual(enable ? hello : [...hello, ...hello]);
      }
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
    "resolves the imports of a document with its nearest tsconfig.json, as bun lint does without a config file",
    async () => {
      const paths = (alias: string) => `{ "compilerOptions": { "paths": { "${alias}/*": ["./src/*"] } } }`;
      using dir = tempDir("bun-lint-lsp", {
        "bunfig.toml": '[lint.rules]\n"import/no-unresolved" = "error"\n',
        "tsconfig.json": paths("@root"),
        "src/y.ts": "export default 1;\n",
        "packages/app/tsconfig.json": paths("@app"),
        "packages/app/src/y.ts": "export default 1;\n",
        "packages/app/src/x.ts": "",
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const x = join(String(dir), "packages", "app", "src", "x.ts");
      open(client, x, 'import b from "@app/y";\nexport default b;\n');
      expect((await client.diagnostics(x)).params).toEqual({ uri: uriOf(x), version: 1, diagnostics: [] });

      // The root's tsconfig.json is not the nearest one.
      client.notify("textDocument/didChange", {
        textDocument: { uri: uriOf(x), version: 2 },
        contentChanges: [{ text: 'import a from "@root/y";\nimport b from "@app/y";\nexport default [a, b];\n' }],
      });
      const changed = await client.diagnostics(x);
      expect(changed.params.diagnostics.map((it: any) => [it.code, it.range.start.line])).toEqual([
        ["import/no-unresolved", 0],
      ]);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // The lint tool's `--config=` follows `lint`; only what precedes it is bun's own, for both halves of the server.
  test(
    "formats with the bunfig.toml when bun lint --lsp is given the lint tool's --config=",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        ".oxlintrc.json": oxlintrc({ rules: { "no-debugger": "error" } }),
        "bunfig.toml": "[fmt]\nsemi = false\n",
        "a.js": "",
      });
      await using client = new Client([...command, "--config=.oxlintrc.json"], String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.js");
      const text = "debugger;\nconst a = 1;\n";
      open(client, path, text);
      const published = await client.diagnostics(path);
      expect(published.params.diagnostics).toEqual([expect.objectContaining({ code: "no-debugger" })]);
      const formatted = await format(client, path);
      expect(formatted.error).toBeUndefined();
      expect(applyEdits(text, formatted.result)).toBe("debugger\nconst a = 1\n");
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // Markdown counts only newlines as line breaks, as the one-shot does: a U+2028 in a line is not a line break. An
  // eslint.config.mjs is read in the plugins' VM, which the server has only on Unix.
  test.skipIf(isWindows)(
    "places a problem of a Markdown document with the line breaks of its language",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        "node_modules/@eslint/markdown/package.json": JSON.stringify({
          name: "@eslint/markdown",
          version: "8.0.3",
          main: "index.js",
        }),
        "node_modules/@eslint/markdown/index.js": `
          const language = { parse: ({ body }) => ({ ok: true, ast: { lines: body.split("\\n") } }) };
          const rule = { create: context => ({ Line: () => context.report({ line: 1, message: "the package" }) }) };
          module.exports = {
            meta: { name: "@eslint/markdown", version: "1.0.0" },
            languages: { commonmark: language, gfm: language },
            rules: { "no-html": rule },
          };`,
        "eslint.config.mjs": `
          import markdown from "@eslint/markdown";
          export default [
            { files: ["**/*.md"], plugins: { markdown }, language: "markdown/gfm", rules: { "markdown/no-html": "error" } },
          ];`,
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.md");
      const text = "# Title\u2028one line\n\n<b>a</b>\n";
      open(client, path, text, "markdown");
      const published = await client.diagnostics(path);
      expect(published.params.diagnostics.map((it: any) => [it.code, it.range.start])).toEqual([
        ["markdown/no-html", { line: 2, character: 0 }],
      ]);
      const [diagnostic] = published.params.diagnostics;
      const actions = await client.request("textDocument/codeAction", {
        textDocument: { uri: uriOf(path) },
        range: diagnostic.range,
        context: { diagnostics: [diagnostic] },
      });
      expect(actions.error).toBeUndefined();
      const action = actions.result.find((it: any) => it.title === "Disable markdown/no-html for this line");
      expect(applyEdits(text, action.edit.changes[uriOf(path)])).toBe(
        "# Title\u2028one line\n\n<!-- eslint-disable-next-line markdown/no-html -->\n<b>a</b>\n",
      );
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // Type errors come with the second lint of a document, which builds the program; the first publish is without them.
  test(
    "reports type errors with --type-check, as bun lint does, and none without it",
    async () => {
      const files = {
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "types": [] } }`,
        "a.ts": "",
      };
      const text = 'export const a: number = "a";\n';
      const codes = (it: Message) => it.params.diagnostics.map((diagnostic: any) => diagnostic.code);
      {
        using dir = tempDir("bun-lint-lsp", files);
        await using client = new Client([...command, "--type-check", "--type-aware"], String(dir));
        expect((await initialize(client, [String(dir)])).error).toBeUndefined();
        client.notify("initialized");
        const path = join(String(dir), "a.ts");
        open(client, path, text);
        let published = await client.diagnostics(path);
        if (published.params.diagnostics.length === 0) published = await client.diagnostics(path);
        expect(codes(published)).toEqual(["typescript/TS2322"]);
        expect((await client.request("shutdown")).result).toBeNull();
        client.notify("exit");
        const { exitCode, garbage, rest } = await client.end();
        expect([garbage, rest]).toEqual([[], ""]);
        expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([]);
        expect(exitCode).toBe(0);
      }
      {
        using dir = tempDir("bun-lint-lsp", files);
        await using client = new Client(command, String(dir));
        expect((await initialize(client, [String(dir)])).error).toBeUndefined();
        client.notify("initialized");
        const path = join(String(dir), "a.ts");
        open(client, path, text);
        expect(codes(await client.diagnostics(path))).toEqual([]);
        expect((await client.request("shutdown")).result).toBeNull();
        client.notify("exit");
        const { exitCode, garbage, rest } = await client.end();
        expect([garbage, rest]).toEqual([[], ""]);
        const published = client.received.filter(it => it.method === "textDocument/publishDiagnostics");
        expect(published.map(codes)).toEqual(published.map(() => []));
        expect(exitCode).toBe(0);
      }
    },
    timeout,
  );

  // With oxlint's configuration `--type-check` needs `--type-aware`, which bun lint refuses to run without.
  test(
    "refuses --type-check without --type-aware once, as bun lint does, and lints nothing",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        ".oxlintrc.json": oxlintrc({ rules: { "no-debugger": "error" } }),
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "types": [] } }`,
        "a.ts": "",
      });
      await using client = new Client([...command, "--type-check"], String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.ts");
      open(client, path, 'debugger;\nexport const a: number = "a";\n');
      expect((await client.diagnostics(path)).params.diagnostics).toEqual([]);
      client.notify("textDocument/didChange", {
        textDocument: { uri: uriOf(path), version: 2 },
        contentChanges: [{ text: 'debugger;\nexport const a: number = "b";\n' }],
      });
      expect((await client.diagnostics(path)).params.diagnostics).toEqual([]);
      // A setting makes a new session, which refuses for the same reason: it is not said again.
      client.notify("workspace/didChangeConfiguration", { settings: { bun: { format: { enable: false } } } });
      client.notify("textDocument/didChange", {
        textDocument: { uri: uriOf(path), version: 3 },
        contentChanges: [{ text: 'debugger;\nexport const a: number = "c";\n' }],
      });
      const third = await client.diagnostics(path);
      expect(third.params).toEqual({ uri: uriOf(path), version: 3, diagnostics: [] });
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([
        expect.objectContaining({
          params: {
            type: 1,
            message: expect.stringContaining("bun lint: The `--type-check` option requires type-aware linting."),
          },
        }),
      ]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // What `bun lint` refuses before it lints, the server refuses too.
  test(
    "refuses a wildcard rule of bunfig.toml next to another tool's config, as bun lint does",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        ".oxlintrc.json": oxlintrc({ rules: { "no-debugger": "error" } }),
        "bunfig.toml": '[lint.rules]\n"unicorn/*" = "off"\n',
        "a.js": "",
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.js");
      open(client, path, "debugger;\n");
      expect((await client.diagnostics(path)).params.diagnostics).toEqual([]);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([
        expect.objectContaining({
          params: {
            type: 1,
            message: expect.stringContaining(`bun lint: "unicorn/*" only works with Bun's own lint config`),
          },
        }),
      ]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // The lint with types builds a program, on a thread of its own, while the other answers requests. Whether the answer
  // comes before the lint ends depends on when the request is read, which CI decides either way: only the answers are
  // checked. The program has a module of 40,000 lines to parse, which makes the lint take long enough to overlap.
  test(
    "answers a formatting request sent while a document is linted with types",
    async () => {
      const functions = Array.from(
        { length: 40_000 },
        (_, i) => `export function f${i}(x: number): number { return x + ${i}; }`,
      );
      using dir = tempDir("bun-lint-lsp", {
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "types": [] } }`,
        "big.ts": functions.join("\n") + "\n",
        "a.ts": "",
      });
      await using client = new Client([...command, "--type-check", "--type-aware"], String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.ts");
      const text = 'import { f0 } from "./big"\nexport const a: number = "a"\nf0(a)\n';
      open(client, path, text);
      const codes = (it: Message) => it.params.diagnostics.map((diagnostic: any) => diagnostic.code);
      // Without types first: the program is being built once this is published.
      expect(codes(await client.diagnostics(path))).toEqual([]);
      const formatted = await format(client, path);
      expect(formatted.error).toBeUndefined();
      expect(applyEdits(text, formatted.result)).toBe(
        'import { f0 } from "./big";\nexport const a: number = "a";\nf0(a);\n',
      );
      const typed = await client.diagnostics(path);
      expect(codes(typed)).toEqual(["typescript/TS2322"]);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // A fix of a rule that needs types is in source.fixAll, from the lint with types that published it: the request
  // builds no program.
  test(
    "fixes what the rules that need types found with source.fixAll",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "types": [] } }`,
        "bunfig.toml":
          '[lint.rules]\n"no-var" = "error"\n"@typescript-eslint/no-unnecessary-type-assertion" = "error"\n',
        "a.ts": "",
      });
      await using client = new Client([...command, "--type-aware"], String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.ts");
      const text = "var n: number = 1;\nvar m = n as number;\nconsole.log(m);\n";
      open(client, path, text);
      const codes = (it: Message) => it.params.diagnostics.map((diagnostic: any) => diagnostic.code);
      let published = await client.diagnostics(path);
      while (codes(published).length < 3) published = await client.diagnostics(path);
      expect(codes(published)).toEqual(["no-var", "no-var", "@typescript-eslint/no-unnecessary-type-assertion"]);
      const uri = uriOf(path);
      const all = await client.request("textDocument/codeAction", {
        textDocument: { uri },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: { diagnostics: [], only: ["source.fixAll"] },
      });
      expect(all.error).toBeUndefined();
      expect(all.result.map((it: any) => it.kind)).toEqual(["source.fixAll.bun"]);
      const editsOf = (action: any): TextEdit[] =>
        action.edit.changes?.[uri] ?? action.edit.documentChanges.find((it: any) => it.textDocument.uri === uri).edits;
      // What `bun lint --type-aware --fix` writes: `prefer-const` is on by default and fixes the `let` of `no-var`.
      expect(applyEdits(text, editsOf(all.result[0]))).toBe("const n: number = 1;\nconst m = n;\nconsole.log(m);\n");
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // An editor asks for `source.fixAll` before it saves, so a document that is linted on save has no lint of that
  // version yet: the request waits for the one with types.
  test(
    "fixes what the rules that need types find with source.fixAll on a version that is not linted yet",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "types": [] } }`,
        "bunfig.toml":
          '[lint.rules]\n"no-var" = "error"\n"@typescript-eslint/no-unnecessary-type-assertion" = "error"\n',
        "a.ts": "",
      });
      await using client = new Client([...command, "--type-aware"], String(dir));
      const started = await initialize(client, [String(dir)], {
        initializationOptions: { lint: { run: "onSave" } },
      });
      expect(started.error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.ts");
      open(client, path, "");
      expect((await client.diagnostics(path)).params.diagnostics).toEqual([]);
      const uri = uriOf(path);
      const text = "var n: number = 1;\nvar m = n as number;\nconsole.log(m);\n";
      client.notify("textDocument/didChange", {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text }],
      });
      const all = await client.request("textDocument/codeAction", {
        textDocument: { uri },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: { diagnostics: [], only: ["source.fixAll.bun"] },
      });
      expect(all.error).toBeUndefined();
      expect(all.result.map((it: any) => it.kind)).toEqual(["source.fixAll.bun"]);
      const editsOf = (action: any): TextEdit[] =>
        action.edit.changes?.[uri] ?? action.edit.documentChanges.find((it: any) => it.textDocument.uri === uri).edits;
      expect(applyEdits(text, editsOf(all.result[0]))).toBe("const n: number = 1;\nconst m = n;\nconsole.log(m);\n");
      // The version is not saved: what was found in it for the request is no diagnostic.
      const published = client.received.filter(it => it.method === "textDocument/publishDiagnostics");
      expect(published.filter(it => it.params.version !== 1)).toEqual([]);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // `source.fixAll` waits for the lint with types, which a plugin holds here. A configuration that changes meanwhile
  // moves the request to the lint with types of the new configuration.
  test.skipIf(isWindows)(
    "answers source.fixAll that waits for a lint with types after a configuration change",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        ".oxlintrc.json": oxlintrc({
          jsPlugins: ["./plugin.mjs"],
          rules: { "demo/hold": "error", "typescript/no-unnecessary-type-assertion": "error" },
        }),
        "plugin.mjs": holdsSecondLint,
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "types": [] } }`,
        "a.ts": "",
      });
      await using client = new Client([...command, "--type-aware"], String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.ts");
      const uri = uriOf(path);
      const text = "const n: number = 1;\nexport const m = n as number;\n";
      open(client, path, text);
      expect((await client.diagnostics(path)).params.diagnostics).toEqual([]);
      const held = join(String(dir), "held");
      while (!existsSync(held)) await Bun.sleep(5);
      try {
        const waiting = client.request("textDocument/codeAction", {
          textDocument: { uri },
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          context: { diagnostics: [], only: ["source.fixAll"] },
        });
        client.notify("workspace/didChangeWatchedFiles", {
          changes: [{ uri: uriOf(String(dir), ".oxlintrc.json"), type: 2 }],
        });
        const all = await waiting;
        expect(all.error).toBeUndefined();
        const editsOf = (action: any): TextEdit[] =>
          action.edit.changes?.[uri] ??
          action.edit.documentChanges.find((it: any) => it.textDocument.uri === uri).edits;
        expect(applyEdits(text, editsOf(all.result[0]))).toBe("const n: number = 1;\nexport const m = n;\n");
      } finally {
        writeFileSync(join(String(dir), "release"), "");
      }
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // The document is linted on save, so its change queues no lint: the request that waits is answered when the lint
  // with types that it waits for is over.
  test.skipIf(isWindows)(
    "answers source.fixAll that waits for a lint with types of a document that changes meanwhile",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        ".oxlintrc.json": oxlintrc({
          jsPlugins: ["./plugin.mjs"],
          rules: { "demo/hold": "error", "typescript/no-unnecessary-type-assertion": "error" },
        }),
        "plugin.mjs": holdsSecondLint,
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "types": [] } }`,
        "a.ts": "",
      });
      await using client = new Client([...command, "--type-aware"], String(dir));
      const started = await initialize(client, [String(dir)], {
        initializationOptions: { lint: { run: "onSave" } },
      });
      expect(started.error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.ts");
      const uri = uriOf(path);
      open(client, path, "const n: number = 1;\nexport const m = n as number;\n");
      expect((await client.diagnostics(path)).params.diagnostics).toEqual([]);
      const held = join(String(dir), "held");
      while (!existsSync(held)) await Bun.sleep(5);
      const waiting = client.request("textDocument/codeAction", {
        textDocument: { uri },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: { diagnostics: [], only: ["source.fixAll"] },
      });
      client.notify("textDocument/didChange", {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: "const n: number = 2;\nexport const m = n as number;\n" }],
      });
      writeFileSync(join(String(dir), "release"), "");
      expect((await waiting).error?.code).toBe(-32801);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // The lint of a document is done before its code actions are answered: what is published when the answer comes is
  // all that the setting made the server lint.
  test(
    "lints no document again when a setting changes that changes no diagnostic",
    async () => {
      using dir = tempDir("bun-lint-lsp", { "bunfig.toml": '[lint.rules]\n"no-var" = "error"\n', "a.js": "" });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.js");
      const uri = uriOf(path);
      open(client, path, "var a = 1;\nconsole.log(a);\n");
      expect((await client.diagnostics(path)).params.diagnostics.map((it: any) => it.code)).toEqual(["no-var"]);
      const publishes = () => client.received.filter(it => it.method === "textDocument/publishDiagnostics").length;
      const actions = () =>
        client.request("textDocument/codeAction", {
          textDocument: { uri },
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          context: { diagnostics: [] },
        });
      const settings = [{ format: { enable: false } }, { lint: { run: "onSave" } }, { format: { enable: true } }];
      for (const bun of settings) {
        client.notify("workspace/didChangeConfiguration", { settings: { bun } });
        expect((await actions()).error).toBeUndefined();
        expect({ bun, publishes: publishes() }).toEqual({ bun, publishes: 1 });
      }
      // The document may have changed since it was last linted.
      client.notify("workspace/didChangeConfiguration", { settings: { bun: { lint: { run: "onType" } } } });
      expect((await actions()).error).toBeUndefined();
      expect(publishes()).toBe(2);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // A plugin holds the thread of the outer folder in the second lint of e.js, so the lint of sub/d.js stays queued
  // there while sub becomes a folder of its own, whose bunfig.toml turns the rule off.
  test.skipIf(isWindows)(
    "lints a document with the configuration of the folder that it is in now, after a folder inside another is added",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        ".oxlintrc.json": oxlintrc({
          jsPlugins: ["./plugin.mjs"],
          rules: { "demo/hold": "error", "no-var": "error" },
        }),
        "plugin.mjs": holdsSecondLint,
        "e.js": "",
        "sub/bunfig.toml": '[lint.rules]\n"no-var" = "off"\n',
        "sub/d.js": "",
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const [outer, inner] = [join(String(dir), "e.js"), join(String(dir), "sub", "d.js")];
      open(client, outer, "export const e = 1;\n");
      expect((await client.diagnostics(outer)).params.diagnostics).toEqual([]);
      client.notify("textDocument/didChange", {
        textDocument: { uri: uriOf(outer), version: 2 },
        contentChanges: [{ text: "export const e = 2;\n" }],
      });
      const held = join(String(dir), "held");
      while (!existsSync(held)) await Bun.sleep(5);
      open(client, inner, "var d = 1;\nconsole.log(d);\n");
      client.notify("workspace/didChangeWorkspaceFolders", {
        event: { added: [{ uri: uriOf(String(dir), "sub"), name: "sub" }], removed: [] },
      });
      const ofInner = await client.diagnostics(inner);
      writeFileSync(join(String(dir), "release"), "");
      // The outer folder lints e.js twice more: the lint that was held, and one for its folders having changed. The
      // lint of d.js that it had queued comes between them.
      const isOuter = (it: Message) =>
        it.method === "textDocument/publishDiagnostics" && it.params.uri === uriOf(outer) && it.params.version === 2;
      await client.notification(isOuter);
      await client.notification(isOuter);
      const codes = client.received
        .filter(it => it.method === "textDocument/publishDiagnostics" && it.params.uri === uriOf(inner))
        .map(it => it.params.diagnostics.map((diagnostic: any) => diagnostic.code));
      expect(codes).toEqual([ofInner.params.diagnostics.map((diagnostic: any) => diagnostic.code)]);
      expect(codes.flat()).not.toContain("no-var");
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // As above, with requests about sub/d.js in the queue of the outer folder when sub becomes a folder: the thread of
  // sub answers them, with its bunfig.toml.
  test.skipIf(isWindows)(
    "answers the requests about a document with the folder that it is in now, after a folder inside another is added",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        ".oxlintrc.json": oxlintrc({
          jsPlugins: ["./plugin.mjs"],
          rules: { "demo/hold": "error", "no-var": "error" },
        }),
        "plugin.mjs": holdsSecondLint,
        "e.js": "",
        "sub/bunfig.toml": '[fmt]\nsemi = false\n\n[lint.rules]\n"no-var" = "off"\n',
        "sub/d.js": "",
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const [outer, inner] = [join(String(dir), "e.js"), join(String(dir), "sub", "d.js")];
      open(client, outer, "export const e = 1;\n");
      expect((await client.diagnostics(outer)).params.diagnostics).toEqual([]);
      client.notify("textDocument/didChange", {
        textDocument: { uri: uriOf(outer), version: 2 },
        contentChanges: [{ text: "export const e = 2;\n" }],
      });
      const held = join(String(dir), "held");
      while (!existsSync(held)) await Bun.sleep(5);
      const text = 'var  d  =  "d";\nconsole.log(d);\n';
      open(client, inner, text);
      const formatted = format(client, inner);
      const actions = client.request("textDocument/codeAction", {
        textDocument: { uri: uriOf(inner) },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        context: { diagnostics: [] },
      });
      client.notify("workspace/didChangeWorkspaceFolders", {
        event: { added: [{ uri: uriOf(String(dir), "sub"), name: "sub" }], removed: [] },
      });
      // The thread of sub lints d.js once the folders have changed: the outer one is let go after that.
      await client.diagnostics(inner);
      writeFileSync(join(String(dir), "release"), "");
      const { error, result } = await formatted;
      expect(error).toBeUndefined();
      expect(applyEdits(text, result)).toBe('var d = "d"\nconsole.log(d)\n');
      const offered = await actions;
      expect(offered.error).toBeUndefined();
      expect(offered.result.filter((it: any) => it.title.includes("no-var"))).toEqual([]);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // A plugin holds the thread of the folder in the second lint of x.js, so the requests about x.js stay queued there
  // while the folder is removed. The file is in no folder then, and is formatted without a/bunfig.toml.
  test.skipIf(isWindows)(
    "answers the queued requests about a document with the root that it is in now, after its folder is removed",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        "a/.oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/hold": "error" } }),
        "a/plugin.mjs": holdsSecondLint,
        "a/bunfig.toml": "[fmt]\nsemi = false\n",
        "a/x.js": "",
      });
      const a = join(String(dir), "a");
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [a])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(a, "x.js");
      open(client, path, "export const x = 1;\n");
      expect((await client.diagnostics(path)).params.diagnostics).toEqual([]);
      const text = 'export const  x  =  "x"\n';
      client.notify("textDocument/didChange", {
        textDocument: { uri: uriOf(path), version: 2 },
        contentChanges: [{ text }],
      });
      while (!existsSync(join(a, "held"))) await Bun.sleep(5);
      try {
        const formatted = format(client, path);
        const actions = client.request("textDocument/codeAction", {
          textDocument: { uri: uriOf(path) },
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          context: { diagnostics: [] },
        });
        client.notify("workspace/didChangeWorkspaceFolders", {
          event: { added: [], removed: [{ uri: uriOf(a), name: "a" }] },
        });
        const { error, result } = await formatted;
        expect(error).toBeUndefined();
        expect(applyEdits(text, result)).toBe('export const x = "x";\n');
        expect((await actions).error).toBeUndefined();
      } finally {
        writeFileSync(join(a, "release"), "");
      }
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // As above, with a request for source.fixAll that waits for the lint with types, which the plugin holds.
  test.skipIf(isWindows)(
    "answers source.fixAll that waits for a lint with types with the root that the document is in now, after its folder is removed",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        "a/.oxlintrc.json": oxlintrc({
          jsPlugins: ["./plugin.mjs"],
          rules: { "demo/hold": "error", "typescript/no-unnecessary-type-assertion": "error" },
        }),
        "a/plugin.mjs": holdsSecondLint,
        "a/tsconfig.json": `{ "compilerOptions": { "strict": true, "types": [] } }`,
        "a/x.ts": "",
      });
      const a = join(String(dir), "a");
      await using client = new Client([...command, "--type-aware"], String(dir));
      expect((await initialize(client, [a])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(a, "x.ts");
      const uri = uriOf(path);
      const text = "const n: number = 1;\nexport const m = n as number;\n";
      open(client, path, text);
      expect((await client.diagnostics(path)).params.diagnostics).toEqual([]);
      while (!existsSync(join(a, "held"))) await Bun.sleep(5);
      try {
        const waiting = client.request("textDocument/codeAction", {
          textDocument: { uri },
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          context: { diagnostics: [], only: ["source.fixAll"] },
        });
        client.notify("workspace/didChangeWorkspaceFolders", {
          event: { added: [], removed: [{ uri: uriOf(a), name: "a" }] },
        });
        const all = await waiting;
        expect(all.error).toBeUndefined();
        const editsOf = (action: any): TextEdit[] =>
          action.edit.changes?.[uri] ??
          action.edit.documentChanges.find((it: any) => it.textDocument.uri === uri).edits;
        expect(applyEdits(text, editsOf(all.result[0]))).toBe("const n: number = 1;\nexport const m = n;\n");
      } finally {
        writeFileSync(join(a, "release"), "");
      }
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // `bun lint` reports what is wrong with a tsconfig.json as a problem of that file, and exits with 1.
  test(
    "shows the error of a tsconfig.json that cannot be used, once",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        ".oxlintrc.json": oxlintrc({ rules: { "typescript/no-floating-promises": "error" } }),
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "types": [], "lib": ["es1"] } }`,
        "a.ts": "",
      });
      await using client = new Client([...command, "--type-aware"], String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.ts");
      // Without types, then from the lint with types, which has no program to ask.
      for (const text of ["Promise.resolve();\n", "Promise.resolve(1);\n"]) {
        if (text.includes("1")) {
          client.notify("textDocument/didChange", {
            textDocument: { uri: uriOf(path), version: 2 },
            contentChanges: [{ text }],
          });
        } else open(client, path, text);
        expect((await client.diagnostics(path)).params.diagnostics).toEqual([]);
        expect((await client.diagnostics(path)).params.diagnostics).toEqual([]);
      }
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(client.received.filter(it => it.method === "window/showMessage").map(it => it.params)).toEqual([
        {
          type: 1,
          message: expect.stringMatching(
            /^bun lint: Cannot use tsconfig\.json:1:\d+: .*\n  The rules that need types do not run for its files$/s,
          ),
        },
      ]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // Plugins run in no VM for a file that is in no workspace folder, and on Windows in none at all: the other rules of
  // the configuration still report, and nothing is shown as an error.
  test(
    "lints with the rules that are built in where the plugins of the configuration cannot run",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        "outside/.oxlintrc.json": oxlintrc({
          jsPlugins: ["./plugin.mjs"],
          rules: { "demo/hello": "error", "no-debugger": "error" },
        }),
        "outside/plugin.mjs": `export default { meta: { name: "demo" }, rules: { hello: { create: () => ({}) } } };`,
        "outside/a.js": "",
        "folder/b.js": "",
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [join(String(dir), "folder")])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "outside", "a.js");
      open(client, path, "debugger;\n");
      const published = await client.diagnostics(path);
      expect(published.params.diagnostics.map((it: any) => it.code)).toEqual(["no-debugger"]);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // An eslint.config.mjs is evaluated in a process of its own. Its plugin's rule runs in a VM, which the server has
  // only on Unix: on Windows the other rules report, and a line in the log says why the plugin's does not.
  test(
    "lints with an ESLint configuration whose plugin cannot run on Windows",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        "plugin.mjs": `export default {
          meta: { name: "demo" },
          rules: {
            hello: {
              create: context => ({ Program: node => context.report({ node, message: "hello from the plugin" }) }),
            },
          },
        };`,
        "eslint.config.mjs": `import demo from "./plugin.mjs";
          export default [{ plugins: { demo }, rules: { "demo/hello": "error", "no-debugger": "error" } }];`,
        "a.js": "",
        "b.js": "",
      });
      await using client = new Client(command, String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      for (const name of ["a.js", "b.js"]) {
        const path = join(String(dir), name);
        open(client, path, "debugger;\n");
        const published = await client.diagnostics(path);
        expect(published.params.diagnostics.map((it: any) => it.code).sort()).toEqual(
          isWindows ? ["no-debugger"] : ["demo/hello", "no-debugger"],
        );
      }
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([]);
      const logged = client.received.filter(it => it.method === "window/logMessage").map(it => it.params.message);
      expect(logged).toEqual(isWindows ? ["Plugins do not run in the editor on this platform"] : []);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // A rule and the rule with types that replaces it both report: `bun lint` shows what the one with types says.
  test(
    "publishes one problem where a rule and its version with types report the same",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        ".oxlintrc.json": oxlintrc({
          rules: { "no-throw-literal": "error", "typescript/only-throw-error": "error" },
        }),
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "types": [] } }`,
        "a.ts": "",
      });
      await using client = new Client([...command, "--type-aware"], String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.ts");
      open(client, path, 'throw "a";\n');
      const codes = (it: Message) => it.params.diagnostics.map((diagnostic: any) => diagnostic.code);
      // Without types first, then with them.
      expect(codes(await client.diagnostics(path))).toEqual(["no-throw-literal"]);
      expect(codes(await client.diagnostics(path))).toEqual(["@typescript-eslint/only-throw-error"]);
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // A lint with types cannot be interrupted. Here a plugin holds the second lint of the document, which is the one
  // with types, until the test lets it go: a configuration that changes meanwhile must not make a request wait for it.
  test.skipIf(isWindows)(
    "answers a request after a configuration change while a lint with types is under way",
    async () => {
      using dir = tempDir("bun-lint-lsp", {
        ".oxlintrc.json": oxlintrc({
          jsPlugins: ["./plugin.mjs"],
          rules: { "demo/hold": "error", "typescript/no-floating-promises": "error" },
        }),
        "plugin.mjs": holdsSecondLint,
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "types": [] } }`,
        "a.ts": "",
      });
      await using client = new Client([...command, "--type-aware"], String(dir));
      expect((await initialize(client, [String(dir)])).error).toBeUndefined();
      client.notify("initialized");
      const path = join(String(dir), "a.ts");
      const text = "export const  a = 1\n";
      open(client, path, text);
      expect((await client.diagnostics(path)).params.diagnostics).toEqual([]);
      const held = join(String(dir), "held");
      while (!existsSync(held)) await Bun.sleep(5);
      try {
        client.notify("workspace/didChangeWatchedFiles", {
          changes: [{ uri: uriOf(String(dir), ".oxlintrc.json"), type: 2 }],
        });
        const formatted = await format(client, path);
        expect(formatted.error).toBeUndefined();
        expect(applyEdits(text, formatted.result)).toBe("export const a = 1;\n");
      } finally {
        writeFileSync(join(String(dir), "release"), "");
      }
      expect((await client.request("shutdown")).result).toBeNull();
      client.notify("exit");
      const { exitCode, garbage, rest } = await client.end();
      expect([garbage, rest]).toEqual([[], ""]);
      expect(client.received.filter(it => it.method === "window/showMessage")).toEqual([]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test.each([
    ["--fix", "--fix"],
    ["--stdin", "--stdin"],
    ["--staged", "--staged or --changed"],
    ["--cwd=.", "--cwd"],
    ["a.js", "Files"],
  ])(
    "refuses %s with --lsp",
    async (arg, named) => {
      using dir = tempDir("bun-lint-lsp", { "a.js": "debugger;\n" });
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
      expect(exitCode).toBe(2);
    },
    timeout,
  );

  test(
    "refuses a request before initialize, and a method it does not have",
    async () => {
      using dir = tempDir("bun-lint-lsp", {});
      await using client = new Client(command, String(dir));
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
