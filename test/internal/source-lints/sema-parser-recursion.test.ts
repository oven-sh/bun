import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

// `bun_sema_parser` (src/sema/parser) is a recursive descent parser, and `bun lint` and
// `bun format` run it on whatever is in a file. `Parser::is_too_deep` says: "Every recursive path
// of the parser passes through a function that asks this". Where that was not so, a file of
// 14,000 `@` overflowed the stack (`primary_expression` -> `decorated_expression` -> `modifiers` ->
// `decorator` -> `left_hand_side_expression` -> `primary_expression`), and so did 100 KB of
// `keyof keyof ..` in a Flow type. This test looks for the next one.
//
// It builds the call graph of the crate from its text and asks that it has no cycle, where a
// function with a GUARD has only the calls that are written before the guard. A guard is
//
//     if self.is_too_deep() {
//
// as a statement of the body itself, not of a block, an arm or a closure in it: then nothing after
// it runs on a stack that is nearly full. `T::X if self.is_too_deep() => ..` is no guard: the
// other arms go on.
//
// To fix a failure: put the guard at the top of one function of the cycle (it is a subtraction and
// a comparison), or write the recursion as a loop.
//
// What counts as a call of `f`, in a method of the type `T`:
//   - `x.f(..)` for any single name `x` (`self`, the `p` of a closure): `T::f`
//   - `.lx.f(..)`, `.names.f(..)`, `.s.f(..)`: the `f` of the type of that field (FIELDS)
//   - `Self::f`, `U::f`, with or without arguments, so a function that is passed by name counts
//     where it is named
//   - `f(..)`: the free function `f`
// A name that the crate does not define is a call out of the crate, which is not followed.
//
// What it sees too much of (never too little): a method of another type with the name of one of
// `T`'s, called on a local.
//
// What it does not see:
//   - Who calls a closure. Its calls count for the function it is written in, which is on the stack
//     whenever the closure runs, as long as no closure is stored (none is).
//   - Calls that a macro writes. `take_span!` and the macros that declare lists call nothing of
//     the parser.
//   - Calls through `dyn Intern` and into other crates (`bun_sema::hir`): they cannot call back.
//   - How much stack the calls between two guards take. `StackCheck` keeps 128 KB for them.
//   - Time: a speculative parse (`try_parse`, `look_ahead_parsing`) is on the same stack, so its
//     depth is checked, but not how often the same text is parsed.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const DIR = "src/sema/parser";
const GUARD = "if self.is_too_deep() {";
const FIELDS: Record<string, string> = { lx: "Lexer", names: "Names", s: "Stacks" };

/** `text` with blanks for its comments and for what is in its string and character literals. */
function withoutCommentsAndLiterals(text: string): string {
  const literal =
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|\bb?r(#*)"[\s\S]*?"\1|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\\n]|\\(?:[^u]|u\{[^}]*\}))'/g;
  return text.replace(literal, found => found.replace(/[^\n]/g, " "));
}

/** The index of the `}` that closes the `{` at `open`. */
function endOfBlock(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  throw new Error("a block is not closed");
}

type Fn = { name: string; type: string; at: string; body: string };

function functionsOf(file: string, source: string): Fn[] {
  const text = withoutCommentsAndLiterals(source);
  const impls: [number, number, string][] = [];
  for (const m of text.matchAll(/^impl(?:<[^>]*>)? (?:[\w:]+(?:<[^>]*>)? for )?(\w+)[^{]*\{/gm)) {
    const open = m.index + m[0].length - 1;
    impls.push([open, endOfBlock(text, open), m[1]]);
  }
  const functions: Fn[] = [];
  for (const m of text.matchAll(/\bfn (\w+)/g)) {
    // The `{` of the body is the first one outside the parentheses of the signature.
    let depth = 0;
    let open = m.index + m[0].length;
    for (; ; open++) {
      const c = text[open];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (depth === 0 && (c === "{" || c === ";")) break;
    }
    if (text[open] === ";") continue;
    functions.push({
      name: m[1],
      type: impls.find(([from, to]) => from < m.index && m.index < to)?.[2] ?? "",
      at: `${file}:${text.slice(0, m.index).split("\n").length}`,
      body: text.slice(open, endOfBlock(text, open) + 1),
    });
  }
  return functions;
}

/** The part of `body` before its guard, or nothing if it has no guard. */
function beforeGuard(body: string): string | undefined {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (depth === 1 && body.startsWith(GUARD, i)) return body.slice(0, i);
    if (body[i] === "{") depth++;
    else if (body[i] === "}") depth--;
  }
}

const functions = [...new Glob("**/*.rs").scanSync({ cwd: path.join(root, DIR) })]
  .map(file => file.replaceAll(path.sep, "/"))
  // The harness, which is not in Bun.
  .filter(file => !file.startsWith("standalone/"))
  .sort()
  .flatMap(file => functionsOf(`${DIR}/${file}`, readFileSync(path.join(root, DIR, file), "utf8")));

const keyOf = (type: string, name: string) => `${type}::${name}`;
const defined = new Set(functions.map(it => keyOf(it.type, it.name)));
const types = new Set(functions.map(it => it.type));

function callsIn(type: string, text: string): string[] {
  const calls = [
    ...text.matchAll(/(?<![\w.$])\w+\.(\w+)\s*\(/g).map(m => keyOf(type, m[1])),
    ...text.matchAll(/\.(\w+)\.(\w+)\s*\(/g).map(m => keyOf(FIELDS[m[1]] ?? "?", m[2])),
    ...text.matchAll(/(\w+)::(\w+)\b/g).map(m => {
      const owner = m[1] === "Self" ? type : m[1];
      return keyOf(types.has(owner) ? owner : "", m[2]);
    }),
    ...text.matchAll(/(?<![\w.:])(\w+)\s*\(/g).map(m => keyOf("", m[1])),
  ];
  return calls.filter(it => defined.has(it));
}

/** The call graph. The functions in `unguarded` are read as if they had no guard. */
function graphWithout(unguarded: string[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const { name, type, body } of functions) {
    const key = keyOf(type, name);
    const read = unguarded.includes(key) ? body : (beforeGuard(body) ?? body);
    const calls = graph.get(key) ?? new Set();
    for (const call of callsIn(type, read.slice(1))) calls.add(call);
    graph.set(key, calls);
  }
  return graph;
}

/** The strongly connected components of `graph` in which there is a cycle (Tarjan). */
function cyclesOf(graph: Map<string, Set<string>>): string[] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[] = [];
  const visit = (v: string) => {
    index.set(v, index.size);
    low.set(v, index.get(v)!);
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v)!) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) !== index.get(v)) return;
    const component = stack.splice(stack.indexOf(v));
    for (const w of component) onStack.delete(w);
    if (component.length > 1 || graph.get(v)!.has(v)) cycles.push(component.sort().join(" "));
  };
  for (const v of graph.keys()) if (!index.has(v)) visit(v);
  return cycles.sort();
}

test("the functions and the guards of the parser are found", () => {
  expect(functions.length).toBeGreaterThan(400);
  const guarded = functions.filter(it => beforeGuard(it.body) !== undefined).map(it => keyOf(it.type, it.name));
  expect(guarded).toContain("Parser::statement");
  expect(guarded).toContain("Parser::ty");
  expect(guarded).toContain("Parser::decorator");
});

test("a recursion whose guard is taken away is found", () => {
  const [cycle] = cyclesOf(graphWithout(["Parser::decorator"]));
  for (const name of ["primary_expression", "decorated_expression", "modifiers", "decorator"]) {
    expect(cycle.split(" ")).toContain(`Parser::${name}`);
  }
  expect(cyclesOf(graphWithout(["Parser::new_expression"]))).toEqual([
    "Parser::new_expression Parser::primary_expression",
  ]);
});

test("every recursive path of the parser passes through a function that asks is_too_deep() first", () => {
  expect(cyclesOf(graphWithout([]))).toEqual([]);
});
