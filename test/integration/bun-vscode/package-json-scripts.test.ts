// The "Bun: Run" and "Bun: Debug" CodeLens buttons above `scripts` in a
// package.json must offer the scripts of that file, and run them from the
// directory of that file. Before the fix they always read the workspace root
// package.json and ran from the workspace root.
// https://github.com/oven-sh/bun/issues/43783
import { beforeEach, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import { commands, makeDocument, MarkdownString, state, vscodeSrc } from "./vscode.mock";

// `vscode` exists only inside VS Code. The mock for it must be registered before
// the module under test is resolved, so a static import cannot be used here.
const { registerPackageJsonProviders } = await import(join(vscodeSrc, "features/tasks/package.json.ts"));
registerPackageJsonProviders({ subscriptions: [] } as any);

const files = {
  "package.json": JSON.stringify({
    private: true,
    workspaces: ["packages/*"],
    scripts: { "root-script": "echo root" },
  }),
  "packages/api/package.json": JSON.stringify({
    name: "example-api",
    scripts: { build: "echo api" },
  }),
  "packages/web/package.json": JSON.stringify({
    name: "example-web",
    scripts: { build: "echo web" },
  }),
};

beforeEach(() => {
  state.pickLabel = "";
  state.quickPickItems = [];
  state.terminals = [];
  state.debugSessions = [];
  state.configScopes = [];
  state.openDocuments = [];
  state.events = [];
  state.errorMessages = [];
  state.shell = "/bin/bash";
});

async function clickCodeLens(root: string, relativePath: string, title: "Bun: Run" | "Bun: Debug", pick: string) {
  state.workspaceRoot = root;
  state.pickLabel = pick;
  const path = join(root, relativePath);
  const document = state.openDocuments.find(document => document.uri.fsPath === path) ?? makeDocument(path);
  const lenses = state.codeLensProvider!.provideCodeLenses(document);
  const lens = lenses.find(lens => lens.command.title.endsWith(title));
  expect(lens).toBeDefined();
  await commands.get(lens!.command.command)!(...lens!.command.arguments);
}

function terminalsAsSeen() {
  return state.terminals.map(terminal => [terminal.creationOptions.cwd, terminal.sent]);
}

test("Bun: Run in a nested package.json offers the scripts of that file", async () => {
  using dir = tempDir("vscode-codelens", files);
  await clickCodeLens(String(dir), "packages/api/package.json", "Bun: Run", "build");

  expect(state.quickPickItems.map(item => item.label)).toEqual(["build"]);
});

test("Bun: Run skips script entries that are not strings", async () => {
  using dir = tempDir("vscode-codelens", {
    "package.json": JSON.stringify({ scripts: { build: "echo ok", broken: ["not", "a", "string"], count: 1 } }),
  });
  await clickCodeLens(String(dir), "package.json", "Bun: Run", "build");

  expect(state.quickPickItems.map(item => item.label)).toEqual(["build"]);
  expect(terminalsAsSeen()).toEqual([[String(dir), ["bun run build"]]]);
});

test.each([
  ["/bin/bash", "bun run 'build docs'", "bun run 'it'\\''s $x'"],
  ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "bun run 'build docs'", "bun run 'it''s $x'"],
  ["C:\\Windows\\System32\\cmd.exe", 'bun run "build docs"', 'bun run "it\'s $x"'],
])("Bun: Run quotes a script name for the default shell %s", async (shell, spaced, quoted) => {
  using dir = tempDir("vscode-codelens", {
    "package.json": JSON.stringify({
      scripts: { "build docs": "echo docs", "test:unit": "bun test", "it's $x": "echo hi" },
    }),
  });
  state.shell = shell;
  await clickCodeLens(String(dir), "package.json", "Bun: Run", "build docs");
  await clickCodeLens(String(dir), "package.json", "Bun: Run", "test:unit");
  await clickCodeLens(String(dir), "package.json", "Bun: Run", "it's $x");

  expect(terminalsAsSeen()).toEqual([
    [String(dir), [spaced]],
    [String(dir), ["bun run test:unit"]],
    [String(dir), [quoted]],
  ]);
});

test("Bun: Run on cmd.exe escapes an embedded double quote", async () => {
  using dir = tempDir("vscode-codelens", {
    "package.json": JSON.stringify({ scripts: { 'say "hi"': "echo hi" } }),
  });
  state.shell = "C:\\Windows\\System32\\cmd.exe";
  await clickCodeLens(String(dir), "package.json", "Bun: Run", 'say "hi"');

  expect(terminalsAsSeen()).toEqual([[String(dir), ['bun run "say \\"hi\\""']]]);
});

test("Bun: Run saves an edited package.json first, so bun sees the script the picker showed", async () => {
  using dir = tempDir("vscode-codelens", files);
  const path = join(String(dir), "packages/api/package.json");
  const edited = makeDocument(path, JSON.stringify({ scripts: { build: "echo api", lint: "eslint ." } }));
  edited.isDirty = true;
  state.openDocuments = [edited];

  await clickCodeLens(String(dir), "packages/api/package.json", "Bun: Run", "lint");

  expect(state.quickPickItems.map(item => item.label)).toEqual(["build", "lint"]);
  expect(edited).toMatchObject({ isDirty: false, saved: 1 });
  expect(terminalsAsSeen()).toEqual([[join(String(dir), "packages/api"), ["bun run lint"]]]);
  // The command is sent only after the save has settled.
  expect(state.events).toEqual(["save:true", "send:bun run lint"]);
});

test("Bun: Run does not run the script when the edited package.json cannot be saved", async () => {
  using dir = tempDir("vscode-codelens", files);
  const path = join(String(dir), "packages/api/package.json");
  const edited = makeDocument(path, JSON.stringify({ scripts: { lint: "eslint ." } }));
  edited.isDirty = true;
  edited.saveResult = false;
  state.openDocuments = [edited];

  await clickCodeLens(String(dir), "packages/api/package.json", "Bun: Run", "lint");

  expect(state.terminals).toEqual([]);
  expect(state.errorMessages).toEqual([`Could not save ${path}. The script was not run.`]);
});

test("Bun: Run falls back to the lenient parser when the package.json is not strict JSON", async () => {
  using dir = tempDir("vscode-codelens", {
    "package.json": `{
  // bun accepts comments and trailing commas in package.json
  "scripts": {
    "build": "echo ok",
    "test": "bun test",
  },
}`,
  });
  await clickCodeLens(String(dir), "package.json", "Bun: Run", "test");

  expect(state.quickPickItems).toEqual([
    { label: "build", detail: "echo ok" },
    { label: "test", detail: "bun test" },
  ]);
  expect(terminalsAsSeen()).toEqual([[String(dir), ["bun run test"]]]);
});

test("Bun: Run in a nested package.json runs the script by name in that package's directory", async () => {
  using dir = tempDir("vscode-codelens", files);
  await clickCodeLens(String(dir), "packages/api/package.json", "Bun: Run", "build");

  expect(terminalsAsSeen()).toEqual([[join(String(dir), "packages/api"), ["bun run build"]]]);
});

test("Bun: Debug in a nested package.json debugs the script in that package's directory", async () => {
  using dir = tempDir("vscode-codelens", files);
  const cwd = join(String(dir), "packages/api");
  await clickCodeLens(String(dir), "packages/api/package.json", "Bun: Debug", "build");

  expect(state.debugSessions).toEqual([
    {
      type: "bun",
      internalConsoleOptions: "neverOpen",
      request: "launch",
      name: "Debug File",
      program: "echo api",
      cwd,
      stopOnEntry: false,
      watchMode: false,
      runtime: "bun",
    },
  ]);
  // The `bun.runtime` setting is read with the package folder as scope.
  expect(state.configScopes.map(scope => scope?.fsPath)).toEqual([cwd]);
});

test("Bun: Run in the root package.json still offers the root scripts", async () => {
  using dir = tempDir("vscode-codelens", files);
  await clickCodeLens(String(dir), "package.json", "Bun: Run", "root-script");

  expect(state.quickPickItems.map(item => item.label)).toEqual(["root-script"]);
  expect(terminalsAsSeen()).toEqual([[String(dir), ["bun run root-script"]]]);
});

test("scripts with the same name in two packages get separate terminals", async () => {
  using dir = tempDir("vscode-codelens", files);
  await clickCodeLens(String(dir), "packages/api/package.json", "Bun: Run", "build");
  await clickCodeLens(String(dir), "packages/web/package.json", "Bun: Run", "build");
  await clickCodeLens(String(dir), "packages/api/package.json", "Bun: Run", "build");

  expect(terminalsAsSeen()).toEqual([
    [join(String(dir), "packages/api"), ["bun run build", "bun run build"]],
    [join(String(dir), "packages/web"), ["bun run build"]],
  ]);
});

test("hover links are only offered for a package.json on disk", () => {
  expect(state.hoverSelector).toEqual({ language: "json", scheme: "file", pattern: "**/package.json" });
});

test("hover links in a nested package.json carry that package's directory", async () => {
  // The command URI must survive a directory name with `#` (a URI fragment delimiter).
  using dir = tempDir("vscode-codelens", {
    ...files,
    "packages/c#/package.json": JSON.stringify({ name: "example-csharp", scripts: { build: "echo c#" } }),
  });
  state.workspaceRoot = String(dir);
  const cwd = join(String(dir), "packages/c#");
  const document = makeDocument(join(cwd, "package.json"));
  const offset = document.getText().indexOf('"build"') + 1;

  const { contents } = state.hoverProvider!.provideHover(document, document.positionAt(offset));
  const markdown = contents.find(content => content instanceof MarkdownString) as MarkdownString;
  expect(markdown).toBeDefined();

  // A command link is `[label](command:<id>?<args>)`. VS Code parses it as a URI, so `#` ends the query.
  const links = [...markdown.value.matchAll(/\]\((command:[^)]+)\)/g)].map(([, link]) => {
    const { pathname, search } = new URL(link);
    return [pathname, JSON.parse(decodeURIComponent(search.slice(1)))];
  });
  expect(links).toEqual([
    ["extension.bun.codelens.debug.task", { script: "echo c#", name: "build", cwd }],
    ["extension.bun.codelens.run.task", { script: "echo c#", name: "build", cwd }],
  ]);
});

test("hover and CodeLens tolerate a trailing comma and a document without scripts", () => {
  using dir = tempDir("vscode-codelens", {
    "package.json": '{ "scripts": { "build": "echo ok", } }',
    "tsconfig.json": '{ "compilerOptions": {} }',
  });
  state.workspaceRoot = String(dir);

  const manifest = makeDocument(join(String(dir), "package.json"));
  const offset = manifest.getText().indexOf('"build"') + 1;
  const { contents } = state.hoverProvider!.provideHover(manifest, manifest.positionAt(offset));
  expect(contents.filter(content => content instanceof MarkdownString)).toHaveLength(1);

  const other = makeDocument(join(String(dir), "tsconfig.json"));
  expect(state.codeLensProvider!.provideCodeLenses(other)).toEqual([]);
  expect(state.hoverProvider!.provideHover(other, other.positionAt(0))).toEqual({ contents: [] });
});

test("hover links carry the unescaped script name", () => {
  using dir = tempDir("vscode-codelens", {
    "package.json": JSON.stringify({ scripts: { 'say "hi"': 'echo "hi"' } }),
  });
  state.workspaceRoot = String(dir);
  const manifest = makeDocument(join(String(dir), "package.json"));
  const offset = manifest.getText().indexOf("say") + 1;

  const { contents } = state.hoverProvider!.provideHover(manifest, manifest.positionAt(offset));
  const markdown = contents.find(content => content instanceof MarkdownString) as MarkdownString;
  const [, link] = markdown.value.match(/\]\((command:[^)]+)\)/)!;
  expect(JSON.parse(decodeURIComponent(new URL(link).search.slice(1)))).toEqual({
    script: 'echo "hi"',
    name: 'say "hi"',
    cwd: String(dir),
  });
});
