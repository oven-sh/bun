// `bun lint --no-script --lsp`: the language server over standard input and output, as an editor uses it. It lints and formats.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { endChildren, spawn } from "../children";
import { applyEdits, Client, format, initialize, open, uriOf, type Message, type TextEdit } from "../lsp-client";

afterAll(endChildren);

const command = [bunExe(), "lint", "--no-script", "--lsp"];

// `bun lint` is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

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

describe.skipIf(!hasRunner).concurrent("bun lint --lsp", () => {
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
    "cancels the requests of a workspace folder that is removed, and formats its files with the defaults afterwards",
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
