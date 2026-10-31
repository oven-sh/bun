// `bun test` takes a file as a test file when its name ends in `.test`, `_test`, `.spec` or `_spec` before a JavaScript
// extension (docs/test/discovery.mdx). The VS Code extension states that rule again in its own code. These tests hold
// each statement to the files that this build of `bun test` runs.
import { afterAll, expect, spyOn, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const extension = join(import.meta.dir, "..", "..", "..", "packages", "bun-vscode");
// The controller imports `vscode`, which exists after vscode.mock.ts has registered it. The specifiers are computed,
// so the type check of test/ does not follow them into the package.
const { makeTestController, makeWorkspaceFolder } = await import(
  join(extension, "src", "features", "tests", "__tests__", "vscode.mock.ts")
);
const { BunTestController } = await import(join(extension, "src", "features", "tests", "bun-test-controller.ts"));
const vscode = await import(String("vscode"));

const extensions = ["cjs", "cts", "js", "jsx", "mjs", "mts", "ts", "tsx"];
const testFiles = [".spec", ".test", "_spec", "_test"]
  .flatMap(suffix => extensions.map(ext => `a${suffix}.${ext}`))
  .sort();
const otherFiles = [
  // The old default pattern of the extension matched these names.
  ...extensions.flatMap(ext => [`a_spec_${ext}`, `a_test_${ext}`]),
  "a_spec_.js",
  "a_test_.ts",
  "a-test.ts",
  "a.tests.ts",
  "atest.ts",
  "test.ts",
  "a.test.json",
  "a_test.txt",
  // Bun has no loader for these extensions.
  "a.test.cjsx",
  "a.spec.mjsx",
  "a_test.ctsx",
  "a_spec.mtsx",
];
const names = [...testFiles, ...otherFiles];

// The extension reads only the paths of documents, so these directories do not have to exist.
const workspace = join(import.meta.dir, "bun-vscode-workspace");
const outside = join(import.meta.dir, "bun-vscode-not-in-the-workspace");
const controller = new BunTestController(makeTestController(), makeWorkspaceFolder(workspace), true);
const { isTestFile, customFilePattern } = controller._internal;
afterAll(() => controller.dispose());
const openedIn = (directory: string) => (name: string) =>
  isTestFile({ uri: { scheme: "file", fsPath: join(directory, name) } });

test("bun test runs the files that end in .test, _test, .spec or _spec", async () => {
  using dir = tempDir(
    "bun-vscode-test-files",
    Object.fromEntries(
      names.map(name => [
        name,
        `import { test } from "bun:test";\nconsole.log("ran ${name}");\ntest("passes", () => {});\n`,
      ]),
    ),
  );
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const ran = stdout
    .split("\n")
    .filter(line => line.startsWith("ran "))
    .map(line => line.slice("ran ".length))
    .sort();
  expect(ran).toEqual(testFiles);
  expect(stderr).toContain(`${testFiles.length} pass`);
  expect(exitCode).toBe(0);
});

test("the default bun.test.filePattern matches the files that bun test runs", () => {
  const manifest = JSON.parse(readFileSync(join(extension, "package.json"), "utf8"));
  const defaultPattern: string = manifest.contributes.configuration.properties["bun.test.filePattern"].default;
  const glob = new Bun.Glob(defaultPattern);
  expect(names.filter(name => glob.match(name))).toEqual(testFiles);
  expect(names.filter(name => glob.match(`src/deep/${name}`))).toEqual(testFiles);

  // VS Code takes the default from package.json. The controller and the README repeat it.
  expect(customFilePattern()).toBe(defaultPattern);
  expect(readFileSync(join(extension, "README.md"), "utf8")).toContain(`"bun.test.filePattern": "${defaultPattern}"`);
});

test("with the default pattern, an opened document is a test file when bun test runs it", () => {
  expect(names.filter(openedIn(workspace))).toEqual(testFiles);
  expect(isTestFile({ uri: { scheme: "untitled", fsPath: join(workspace, "a.test.ts") } })).toBe(false);

  // The default pattern costs no glob match per opened document.
  const match = spyOn(vscode.languages, "match");
  expect(names.filter(openedIn(outside))).toEqual(testFiles);
  expect(match).not.toHaveBeenCalled();
  match.mockRestore();
});
