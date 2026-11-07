// https://github.com/oven-sh/bun/issues/23591
//
// The VS Code extension took every opened `*.test.*` and `*.spec.*` document as a Bun test file, also when
// `bun.test.filePattern` did not match it. With `**/*.test.ts`, a Playwright `listing.spec.ts` still got a Bun run
// button.
import { afterEach, expect, spyOn, test } from "bun:test";
import { join } from "node:path";

const extension = join(import.meta.dir, "..", "..", "..", "packages", "bun-vscode", "src", "features", "tests");
// The controller imports `vscode`, which exists after vscode.mock.ts has registered it. The specifiers are computed,
// so the type check of test/ does not follow them into the package.
const { makeTestController, makeWorkspaceFolder } = await import(join(extension, "__tests__", "vscode.mock.ts"));
const { BunTestController, debug } = await import(join(extension, "bun-test-controller.ts"));
const vscode = await import(String("vscode"));

// The extension reads only the paths of documents, so these directories do not have to exist.
const workspace = join(import.meta.dir, "23591-workspace");
const outside = join(import.meta.dir, "23591-not-in-the-workspace");
const workspaceFolder = makeWorkspaceFolder(workspace);

const setFilePattern = (value: unknown) => vscode.workspace.getConfiguration("bun.test").update("filePattern", value);
const controllers: { dispose(): void }[] = [];

// The extension reads the setting when the window loads. So a test sets the value first, then makes the controller.
async function controllerWith(filePattern: unknown) {
  await setFilePattern(filePattern);
  const controller = new BunTestController(makeTestController(), workspaceFolder, true);
  controllers.push(controller);
  const { isTestFile, customFilePattern, discoverInitialTests } = controller._internal;
  const openedIn = (directory: string) => (path: string) =>
    isTestFile({ uri: { scheme: "file", fsPath: join(directory, path) } });
  return { customFilePattern, discoverInitialTests, opened: openedIn(workspace), openedOutside: openedIn(outside) };
}

const showInformationMessage = vscode.window.showInformationMessage;
afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vscode.window.showInformationMessage = showInformationMessage;
  await setFilePattern(undefined);
});

const paths = [
  "a.test.ts",
  "a.spec.ts",
  "web/browser/listing.spec.ts",
  "src/a.test.ts",
  "src/a.test.js",
  "src/deep/a.test.ts",
  "lib/src/a.test.ts",
  "checks/login.ts",
  "src/notes.md",
];
const testNames = paths.filter(path => /\.(test|spec)\.[jt]s$/.test(path));
const { customFilePattern } = await controllerWith(undefined);
const defaultPattern: string = customFilePattern();

test("an opened document is a test file only when bun.test.filePattern matches it", async () => {
  const { opened, openedOutside, customFilePattern } = await controllerWith("**/*.test.ts");
  const matches = ["a.test.ts", "src/a.test.ts", "src/deep/a.test.ts", "lib/src/a.test.ts"];
  expect(paths.filter(opened)).toEqual(matches);
  expect(paths.filter(openedOutside)).toEqual(matches);
  expect(customFilePattern()).toBe("**/*.test.ts");

  // The pattern decides, not the file name.
  expect(paths.filter((await controllerWith("checks/**")).opened)).toEqual(["checks/login.ts"]);
});

test("bun.test.filePattern applies to the path inside the workspace folder", async () => {
  const { opened, openedOutside } = await controllerWith("src/**/*.test.ts");
  expect(paths.filter(opened)).toEqual(["src/a.test.ts", "src/deep/a.test.ts"]);
  // A document outside the workspace has no folder. The pattern then has to match the whole path.
  expect(paths.filter(openedOutside)).toEqual([]);
});

test.each([
  ["an empty string", ""],
  ["spaces", "  "],
  ["an array", ["**/*.test.ts"]],
])("bun.test.filePattern set to %s means the default pattern", async (_, value) => {
  const appendLine = spyOn(debug, "appendLine");
  const { opened, openedOutside, customFilePattern } = await controllerWith(value);
  expect(appendLine.mock.calls).toEqual([
    [`bun.test.filePattern is ${JSON.stringify(value)}, not a glob pattern. The default applies: ${defaultPattern}`],
  ]);
  appendLine.mockRestore();
  expect(customFilePattern()).toBe(defaultPattern);
  expect(paths.filter(opened)).toEqual(testNames);
  expect(paths.filter(openedOutside)).toEqual(testNames);
});

test("a change of bun.test.filePattern asks for a window reload", async () => {
  const { opened, customFilePattern } = await controllerWith("**/*.test.ts");
  const message = 'Reload the window to apply the new "bun.test.filePattern".';
  const asked: string[][] = [];
  const dismissed = Promise.withResolvers<undefined>();
  const answers = [dismissed.promise, Promise.resolve("Reload Window")];
  vscode.window.showInformationMessage = (...args: string[]) => answers[asked.push(args) - 1];

  await vscode.workspace.getConfiguration("editor").update("fontSize", 14);
  await setFilePattern("**/*.spec.ts");
  expect(asked).toEqual([[message, "Reload Window"]]);

  const reloaded = Promise.withResolvers<string>();
  const executeCommand = spyOn(vscode.commands, "executeCommand").mockImplementation(async (command: string) => {
    reloaded.resolve(command);
  });
  // The user dismisses the first message and takes the button of the second.
  dismissed.resolve(undefined);
  await setFilePattern("**/*.test.tsx");
  expect(await reloaded.promise).toBe("workbench.action.reloadWindow");
  expect(executeCommand).toHaveBeenCalledTimes(1);
  executeCommand.mockRestore();

  // Until the window reloads, the controller keeps the pattern it started with.
  expect(customFilePattern()).toBe("**/*.test.ts");
  expect(paths.filter(opened)).toEqual(["a.test.ts", "src/a.test.ts", "src/deep/a.test.ts", "lib/src/a.test.ts"]);
});

test("a bun.test.filePattern that matches no file is named in the output channel", async () => {
  const found = { fsPath: join(workspace, "test", "a.test.ts"), toString: () => "file:///a.test.ts" };
  const results: (typeof found)[][] = [[], [found], []];
  const findFiles = spyOn(vscode.workspace, "findFiles").mockImplementation(async (include: string) =>
    include === "**/.gitignore" ? [] : results.shift(),
  );
  const appendLine = spyOn(debug, "appendLine");

  const { discoverInitialTests } = await controllerWith("test/*.test.ts");
  // The search finds nothing, then one file.
  await discoverInitialTests();
  await discoverInitialTests();
  // With the default pattern an empty search is not reported.
  await (await controllerWith(undefined)).discoverInitialTests();

  expect(appendLine.mock.calls).toEqual([['bun.test.filePattern "test/*.test.ts" matches no file in the workspace.']]);
  appendLine.mockRestore();
  findFiles.mockRestore();
});
