// VS Code sends the text of its Debug Console, Watch view and hovers to the debug adapter
// (packages/bun-debug-adapter-protocol), and the adapter asks the debuggee to evaluate it. These
// tests pin the text the adapter sends and what VS Code prints, for text that starts with `{`.
import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { join } from "node:path";
import { attach, type Request, type Result } from "./debug-adapter-evaluate-fixture.ts";

// The debuggee stays paused in an arrow function, in a method of a derived class. The parser of that
// frame accepts private names and `super`. No parser outside the frame does.
const debuggee = `
  globalThis.foo = () => "foo";
  globalThis.za = 0;
  globalThis.zb = 0;
  globalThis.ran = 0;
  globalThis.typed = 0;
  globalThis.target = { p: 1 };
  class Base {
    base() {
      return "base";
    }
  }
  class Counter extends Base {
    #count = 42;
    read() {
      const local = { k: 7 };
      return (() => {
        debugger;
        return [local, this.#count, super.base()];
      })();
    }
  }
  new Counter().read();
  throw new Error("The debuggee did not stay paused on its debugger statement.");
`;

type Row = { name: string; request: Request; expected: Result };
type Where = { onCallFrame?: boolean; context?: string };

/** A Debug Console input: the text the adapter sends for it, and what the console prints. */
function evaluate(expression: string, sent: string, printed: string, where: Where = {}): Row {
  const context = where.context ? `, context ${where.context}` : "";
  return {
    name: `evaluate ${JSON.stringify(expression)}${where.onCallFrame ? " on the call frame" : ""}${context}`,
    request: { command: "evaluate", expression, ...where },
    expected: {
      sent: [[where.onCallFrame ? "Debugger.evaluateOnCallFrame" : "Runtime.evaluate", sent]],
      printed,
      // The adapter may drop the parentheses only from text that the evaluator cannot read in them.
      ...(sent.startsWith("{") && { parenthesizedParses: false }),
    },
  };
}
const asTyped = (expression: string, printed: string, where?: Where) =>
  evaluate(expression, expression, printed, where);
const parenthesized = (expression: string, printed: string, where?: Where) =>
  evaluate(expression, `(${expression}\n)`, printed, where);
/** The one kind of row where the adapter sends without parentheses a text that the evaluator can read in them. */
const knownLimit = (row: Row): Row => ({ ...row, expected: { ...row.expected, parenthesizedParses: true } });

const onCallFrame = { onCallFrame: true };
const throwsWhenItRuns = `{ a: (globalThis.ran++, JSON.parse("{")) }`;

// The requests run in this order, against one debuggee.
const rows: Row[] = [
  // Statements: the `{` opens a block.
  asTyped("{0}", "0"),
  asTyped("{;}", "undefined"),
  asTyped("{ let x = 1; x }", "1"),
  asTyped("{ foo() }", '"foo"'),
  asTyped("{ 1; 2; }", "2"),
  asTyped("{ if (true) 5 }", "5"),
  asTyped("{ a: 1 }; 3", "3"),
  asTyped("{ let d = local.k * 2; d }", "14", onCallFrame),
  ...["repl", "watch", "variables", "clipboard"].map(context => asTyped("{ let x = 1; x }", "1", { context })),
  // A trailing `;` makes a statement, as in node's REPL. Chrome DevTools prints the object.
  asTyped("{ a: 1 };", "1"),
  evaluate("return { a: 1 };", "{ a: 1 };", "1"),
  // A mistyped object literal that is a valid block runs as the block, as in node's REPL.
  asTyped("{ a: 1; b: 2 }", "2"),

  // One expression: the `{` opens an object literal.
  parenthesized("{}", "{}"),
  parenthesized("{ a: 1, b: 2 }", "{a: 1, b: 2}"),
  parenthesized("{ a: 1 }.a", "1"),
  parenthesized("{ a: 1 } + 1", '"[object Object]1"'),
  parenthesized("{ za, zb } = { za: 1, zb: 2 }", "{za: 1, zb: 2}"),
  parenthesized("{ k: local.k }", "{k: 7}", onCallFrame),
  // A line comment must not hide the `)`. node's REPL reads these two as blocks and prints 1.
  parenthesized("{ a: 1 } // note", "{a: 1}"),
  parenthesized("{ a: 1 }\n// note", "{a: 1}"),

  // `return` and `await` come off before the `{` is read.
  evaluate("return { a: 1 }", "({ a: 1 }\n)", "{a: 1}"),
  evaluate("await { a: 1 }", "({ a: 1 }\n)", "{a: 1}"),
  evaluate("return  { a: 1 }", "({ a: 1 }\n)", "{a: 1}"),
  evaluate("await  { a: 1 }", "({ a: 1 }\n)", "{a: 1}"),
  evaluate("return { let x = 2; x }", "{ let x = 2; x }", "2"),

  // The adapter's parser rejects both readings of text that only the debuggee can parse. The
  // parentheses stay: the text is an object literal for the paused frame, or for JavaScriptCore.
  parenthesized("{ a: this.#count }", "{a: 42}", onCallFrame),
  parenthesized("{ a: this.#count, b: #count in this }", "{a: 42, b: true}", onCallFrame),
  parenthesized("{ a: this.#count, b: /[\\#a]/v }", "{a: 42, b: /[\\#a]/v}", onCallFrame),
  parenthesized("{ a: super.base() }", '{a: "base"}', onCallFrame),
  parenthesized("{ a: import.defer('node:os') }", "{a: Promise}"),
  // Neither reading parses anywhere: the error is the one of the object literal, as before.
  parenthesized("{ a: 1, b: }", "SyntaxError: Unexpected token '}'"),

  // Text that only the paused frame can parse keeps the reading it had before, right or wrong.
  evaluate("return { const v = this.#count; v }", "{ const v = this.#count; v }", "42", onCallFrame),
  // Known limit: a block keeps its parentheses, and fails.
  parenthesized(
    "{ const v = this.#count; v }",
    "SyntaxError: Unexpected identifier 'v'. Expected a ':' following the property name 'const'.",
    onCallFrame,
  ),
  // Known limit: after `return`, an object literal is read as a block. The frame can parse it in parentheses.
  knownLimit(evaluate("return { a: this.#count }", "{ a: this.#count }", "42", onCallFrame)),

  // Text that does not start with `{` goes out as typed.
  asTyped("1 + 1", "2"),
  asTyped("let y = 3; y", "3"),
  asTyped("function f() { return 1 }", "undefined"),
  evaluate("return 1 + 1", "1 + 1", "2"),

  // An object literal that throws a SyntaxError while it runs is not evaluated again as a block.
  parenthesized(throwsWhenItRuns, "SyntaxError: JSON Parse error: Expected '}'"),
  asTyped("globalThis.ran", "1"),
  parenthesized(throwsWhenItRuns, "SyntaxError: JSON Parse error: Expected '}'", onCallFrame),
  asTyped("globalThis.ran", "2"),

  // The adapter compiles the text in its own process. The text must not run there.
  parenthesized("{ a: (globalThis.ranDebugConsoleInput = true) }", "{a: true}"),
  asTyped("{ globalThis.ranDebugConsoleInput = true; 1 }", "1"),
  {
    name: "the process that hosts the adapter did not run the text",
    request: { command: "hostGlobal", name: "ranDebugConsoleInput" },
    expected: { sent: [], printed: "false" },
  },

  // VS Code asks for a hover when the mouse moves, and for completions while the user types.
  // Neither runs statements. A hover that does not parse is cancelled.
  parenthesized("{ a: 1 }", "{a: 1}", { context: "hover" }),
  parenthesized("{ globalThis.typed++; 1 }", "Symbol(Cancel)", { context: "hover" }),
  parenthesized("{ globalThis.typed++; local.k }", "Symbol(Cancel)", { context: "hover", onCallFrame: true }),
  {
    name: "completions of an object literal",
    request: { command: "completions", text: "{ a: 1, bb: 2 }." },
    expected: { sent: [["Runtime.evaluate", "({ a: 1, bb: 2 }\n)"]], printed: ["a", "bb"] },
  },
  {
    name: "completions of text that is statements",
    request: { command: "completions", text: "{ a: 1 }; globalThis.typed++; target." },
    expected: { sent: [["Runtime.evaluate", "({ a: 1 }; globalThis.typed++; target\n)"]], printed: [] },
  },
  // "Set Value" on a Watch expression assigns to a target, which is never statements.
  {
    name: "setExpression",
    request: { command: "setExpression", expression: "target.p", value: "2" },
    expected: { sent: [["Runtime.evaluate", "target.p = (2);"]], printed: "2" },
  },
  {
    name: "setExpression with a target that is statements",
    request: { command: "setExpression", expression: "{ globalThis.typed++ } target.p", value: "3" },
    expected: {
      sent: [["Runtime.evaluate", "({ globalThis.typed++ } target.p = (3);\n)"]],
      printed: "SyntaxError: Unexpected token '.'. Expected a ':' following the property name 'globalThis'.",
    },
  },
  asTyped("globalThis.typed", "0"),
];

const requests = rows.map(({ request }) => request);

function everyRowMatches(results: () => Result[]) {
  test.each(rows.map(({ name }, index) => [name, index] as const))("%s", (_, index) => {
    expect(results()[index]).toEqual(rows[index].expected);
  });
}

describe("debug adapter hosted by bun", () => {
  let session: Awaited<ReturnType<typeof attach>> | undefined;
  let results: Result[] = [];

  beforeAll(async () => {
    session = await attach(bunExe(), bunEnv, debuggee);
  });
  beforeAll(async () => {
    results = await session!.run(requests);
  });
  afterAll(() => session?.close());

  everyRowMatches(() => results);
});

// VS Code hosts the adapter in node, so there V8 is the parser that reads the `{`.
describe.skipIf(!nodeExe())("debug adapter hosted by node", () => {
  let dir: ReturnType<typeof tempDir> | undefined;
  let results: Result[] = [];

  beforeAll(async () => {
    dir = tempDir("debug-adapter-evaluate", {});
    const { success, logs } = await Bun.build({
      entrypoints: [join(import.meta.dir, "debug-adapter-evaluate-fixture.ts")],
      outdir: String(dir),
      target: "node",
      format: "cjs",
      // node finds `ws` through NODE_PATH.
      external: ["ws"],
    });
    expect({ success, logs }).toEqual({ success: true, logs: [] });
  });
  beforeAll(async () => {
    await using node = spawn({
      cmd: [nodeExe()!, join(String(dir), "debug-adapter-evaluate-fixture.js")],
      env: { ...bunEnv, NODE_PATH: join(import.meta.dir, "..", "..", "node_modules"), NODE_NO_WARNINGS: "1" },
      stdin: Buffer.from(JSON.stringify([bunExe(), debuggee, requests])),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([node.stdout.text(), node.stderr.text(), node.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    results = JSON.parse(stdout);
  });
  afterAll(() => dir?.[Symbol.dispose]());

  everyRowMatches(() => results);
});
