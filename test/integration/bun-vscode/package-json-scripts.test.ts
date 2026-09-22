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
const { providePackageJsonTasks, registerPackageJsonProviders } = await import(
  join(vscodeSrc, "features/tasks/package.json.ts")
);

state.provideTasks = providePackageJsonTasks;
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
});

async function clickCodeLens(root: string, relativePath: string, title: "Bun: Run" | "Bun: Debug", pick: string) {
  state.workspaceRoot = root;
  state.pickLabel = pick;
  const document = makeDocument(join(root, relativePath));
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

test("hover links are only offered for documents on disk", () => {
  expect(state.hoverSelector).toEqual({ language: "json", scheme: "file" });
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
