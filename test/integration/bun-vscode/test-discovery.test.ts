// The VS Code extension (packages/bun-vscode) reads a test file, without running it, to list
// its tests in the Test Explorer. These tests compare that list with the tests `bun test` runs.
// They are under test/ because CI runs only the tests there.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import "../../../packages/bun-vscode/src/features/tests/__tests__/vscode.mock";
import {
  makeTestController,
  makeWorkspaceFolder,
} from "../../../packages/bun-vscode/src/features/tests/__tests__/vscode.mock";

const { BunTestController } = await import("../../../packages/bun-vscode/src/features/tests/bun-test-controller");

const controller = new BunTestController(makeTestController(), makeWorkspaceFolder("/workspace"), true);
const { parseTestBlocks, buildTestNamePattern, escapeTestName } = controller._internal;

type TestNode = ReturnType<typeof parseTestBlocks>[number];

// The tests that the extension finds in `source`, each as "describe > describe > test".
function discover(source: string): string[] {
  const paths = (nodes: TestNode[], prefix: string): string[] =>
    nodes.flatMap(node =>
      node.type === "describe" ? paths(node.children, `${prefix}${node.name} > `) : [prefix + node.name],
    );
  return paths(parseTestBlocks(source), "");
}

// The tests that `bun test` runs in `source`, in the same form.
async function run(source: string, ...args: string[]) {
  using dir = tempDir("vscode-test-discovery", { "fixture.test.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "fixture.test.ts", ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const passed = Array.from(stderr.matchAll(/^\(pass\) (.*?)(?: \[\d+(?:\.\d+)?ms\])?\r?$/gm), match => match[1]);
  return { passed, exitCode };
}

// The --test-name-pattern that the extension runs the top-level node `name` with.
function namePattern(name: string, type: TestNode["type"]): string {
  const item = { id: "fixture.test.ts#" + escapeTestName(name), tags: [{ id: type }] };
  return buildTestNamePattern([item as any])!;
}

test.concurrent("the tests around .each and .if arguments are the tests that run", async () => {
  const source = `
    import { describe, test } from "bun:test";
    const on = () => true;

    describe.each([[1], [2]])("group %i", () => {
      describe.each([["a"], ["b"]])("inner %s", () => {
        test("leaf", () => {});
      });
      test("mid", () => {});
    });
    describe.skipIf(!on())("condition with a call", () => {
      test("inside", () => {});
    });
    test.if(on())("if with a call", () => {});
    test.each([["a)"], ["(b"]])("parenthesis %s", () => {});
    test("mentions .each", () => {});
    test.each([[1], [2]])("literal %i", () => {});
  `;
  const tests = [
    "group 1 > inner a > leaf",
    "group 1 > inner b > leaf",
    "group 1 > mid",
    "group 2 > inner a > leaf",
    "group 2 > inner b > leaf",
    "group 2 > mid",
    "condition with a call > inside",
    "if with a call",
    "parenthesis a)",
    "parenthesis (b",
    "mentions .each",
    "literal 1",
    "literal 2",
  ];

  expect(discover(source)).toEqual(tests);
  expect(await run(source)).toEqual({ passed: tests, exitCode: 0 });
});

test.concurrent("a row of a template table has the name that the runtime gives it", async () => {
  const headings = ["name", "count", "ok"];
  const rows = [
    ['"apple"', "1", "true"],
    ["'pear tree'", "-0", "false"],
    ['"with $dollar"', "2.50", "true"],
    ['"ünï 日本"', "1e21", "false"],
  ];
  const titles = ["$name has $count: $ok", "[$count] of 100%", "$name costs $"];

  // bun:test makes one object per row of a template table, keyed by the headings. So a row has
  // the name of the same row in an array of objects.
  const template = ["", headings.join(" | "), ...rows.map(row => row.map(cell => `\${${cell}}`).join(" | ")), ""];
  const objects = rows.map(row => `{ ${row.map((cell, column) => `${headings[column]}: ${cell}`).join(", ")} }`);
  const asTemplate = titles.map(title => `test.each\`${template.join("\n")}\`(${JSON.stringify(title)}, () => {});`);
  const asObjects = titles.map(title => `test.each([${objects.join(", ")}])(${JSON.stringify(title)}, () => {});`);

  const discovered = discover(asTemplate.join("\n"));

  expect(discovered.slice(0, rows.length)).toEqual([
    "apple has 1: true",
    "pear tree has -0: false",
    "with $dollar has 2.5: true",
    "ünï 日本 has 1e+21: false",
  ]);
  expect(discovered).toHaveLength(titles.length * rows.length);
  expect(await run(asObjects.join("\n"))).toEqual({ passed: discovered, exitCode: 0 });
});

test.concurrent("a table that only the runtime can read keeps its title, and the title selects every row", async () => {
  const template = "test.each`\n  a | b\n  ${first} | ${1}\n  ${second} | ${2}\n`('compares $a with $b', () => {});";
  const variable = "test.each(cases)('from a variable %s', () => {});\ntest.each([[1], [2]])('literal %i', () => {});";

  expect(discover(template)).toEqual(["compares $a with $b"]);
  expect(discover(variable)).toEqual(["from a variable %s", "literal 1", "literal 2"]);

  const source = `
    import { test } from "bun:test";
    const first = "x", second = "y", cases = [["z"]];

    test.each([{ a: first, b: 1 }, { a: second, b: 2 }])("compares $a with $b", () => {});
    ${variable}
  `;
  const pattern = [namePattern("compares $a with $b", "test"), namePattern("from a variable %s", "test")].join("|");

  expect(await run(source, "--test-name-pattern", pattern)).toEqual({
    passed: ["compares x with 1", "compares y with 2", "from a variable z"],
    exitCode: 0,
  });
});
