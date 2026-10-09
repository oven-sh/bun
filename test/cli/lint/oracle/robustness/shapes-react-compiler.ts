// More shapes, for the rules that report what the React Compiler finds: react/refs, react/immutability, react/hooks and the other
// 19. In the form of shapes.ts. A component or a hook, which is what the compiler reads, has n of one thing in `wide(n)` and one
// thing n deep in `deep(n)`. Its passes work on instructions, on the blocks of a control flow graph, on the variables and on the
// functions in a function, so there is a shape for what makes many of each.
//
// And the cases of cases.ts for these rules. The passes take time and memory in proportion to the square or the cube of some of
// these numbers, so a function that is above a limit is not compiled, and react/todo says so.
import { RULE_NAMES } from "../react-compiler/shared";
import type { Case } from "./cases";

const seq = (n: number, f: (i: number) => string, sep = "") => Array.from({ length: n }, (_, i) => f(i)).join(sep);
/** `"".repeat` is slow in a debug build of JavaScriptCore. */
const rep = (text: string, n: number) => Buffer.alloc(Buffer.byteLength(text) * n, text).toString();

/** A shape is made when it is asked for. */
function lazily(shapes: Record<string, () => string>): Record<string, string> {
  const made: Record<string, string> = {};
  for (const [name, make] of Object.entries(shapes)) Object.defineProperty(made, name, { get: make, enumerable: true });
  return made;
}

const component = (body: string, returns = "<div />") =>
  `function Component(props) {\n  const [s, setS] = useState(0);\n${body}\n  return ${returns};\n}\n`;
const components = (n: number) => seq(n, i => `function C${i}(props) { useState(0); return <a />; }\n`);

const wideShapes: Record<string, (n: number) => string> = {
  // ── chains, which the parser reads in a loop ──
  "rc-binary.jsx": n => component(`const x = ${rep("s + ", n)}s;`),
  "rc-logical.jsx": n => component(`const x = ${rep("s && ", n)}s;`),
  "rc-nullish.jsx": n => component(`const x = ${rep("s ?? ", n)}s;`),
  "rc-comma.jsx": n => component(`const x = (${rep("s, ", n)}s);`),
  "rc-dots.jsx": n => component(`const x = props${rep(".a", n)};`),
  "rc-optional-dots.jsx": n => component(`const x = props${rep("?.a", n)};`),
  "rc-indexes.jsx": n => component(`const x = props${rep("[s]", n)};`),
  "rc-call-chain.jsx": n => component(`const x = props${rep(".a()", n)};`),
  "rc-optional-call-chain.jsx": n => component(`const x = props${rep("?.a?.()", n)};`),
  "rc-capitalized-call-chain.jsx": n => component(`const x = props${rep(".Foo()", n)};`),
  // ── instructions ──
  "rc-statements.jsx": n => component(rep("  s;\n", n)),
  "rc-variables.jsx": n => component(seq(n, i => `  const v${i} = s + ${i};\n`)),
  "rc-variable-chain.jsx": n => component("  const v0 = s;\n" + seq(n, i => `  const v${i + 1} = v${i} + 1;\n`)),
  "rc-reassignments.jsx": n => component("  let v = s;\n" + rep("  v = v + 1;\n", n)),
  "rc-arguments-of-a-call.jsx": n => component(`const x = f(${rep("s,", n)});`),
  "rc-parameters.jsx": n => `function useFoo(${seq(n, i => `a${i}`, ",")}) { useState(0); return a0; }\n`,
  "rc-elements.jsx": n => component(`const x = [${rep("s,", n)}];`),
  "rc-properties.jsx": n => component(`const x = {${seq(n, i => `a${i}: s`, ",")}};`),
  "rc-pattern-properties.jsx": n => component(`const {${seq(n, i => `a${i}`, ",")}} = props;`),
  "rc-pattern-defaults.jsx": n => component(`const {${seq(n, i => `a${i} = s`, ",")}} = props;`),
  "rc-children.jsx": n => component("", `<a>${rep("<b />", n)}</a>`),
  "rc-expression-children.jsx": n => component("", `<a>${rep("{s}", n)}</a>`),
  "rc-attributes.jsx": n => component("", `<a ${seq(n, i => `a${i}={s}`, " ")} />`),
  "rc-spread-attributes.jsx": n => component("", `<a ${rep("{...props} ", n)}/>`),
  "rc-quasis.jsx": n => component("const x = `" + rep("${s}", n) + "`;"),
  "rc-string.jsx": n => component(`const x = '${rep("a", n)}';`),
  "rc-text.jsx": n => component("", `<a>${rep("a ", n)}</a>`),
  // ── blocks of the control flow graph ──
  "rc-ifs.jsx": n => component(seq(n, i => `  if (props.a${i}) { s; }\n`)),
  "rc-if-returns.jsx": n => component(seq(n, i => `  if (props.a${i}) return null;\n`)),
  "rc-cases.jsx": n => component(`switch (s) {${seq(n, i => `case ${i}: s; break;\n`)}}`),
  "rc-cases-that-fall-through.jsx": n => component(`switch (s) {${seq(n, i => `case ${i}: s;\n`)}}`),
  "rc-for-of.jsx": n => component(seq(n, i => `  for (const a${i} of props.l) { s; }\n`)),
  "rc-breaks.jsx": n => component(`  for (;;) {${seq(n, i => ` if (props.a${i}) break;\n`)}}`),
  "rc-continues.jsx": n => component(`  for (const a of props.l) {${seq(n, i => ` if (props.a${i}) continue;\n`)}}`),
  "rc-trys.jsx": n => component(rep("  try { s; } catch (e) { s; }\n", n)),
  "rc-jsx-in-try.jsx": n => component(`let x; try {${rep("x = <a />;\n", n)}} catch (e) {}`),
  // ── a variable that is assigned on many paths ──
  "rc-one-phi.jsx": n => component("  let v = 0;\n" + seq(n, i => `  if (props.a${i}) { v = ${i}; }\n`) + "  v;"),
  "rc-phis.jsx": n =>
    component(
      seq(n, i => `  let v${i} = 0;\n`) + `  if (props.a) {${seq(n, i => `v${i} = 1;`)}}\n` + seq(n, i => `  v${i};\n`),
    ),
  "rc-phis-of-a-loop.jsx": n =>
    component(seq(n, i => `  let v${i} = 0;\n`) + `  while (props.a) {${seq(n, i => `v${i} = v${(i + 1) % n} + 1;`)}}`),
  // ── names ──
  "rc-same-name-in-blocks.jsx": n => component(rep("  { const a = s; a; }\n", n)),
  "rc-hoisted-functions.jsx": n =>
    component(seq(n, i => `  f${i}();\n`) + seq(n, i => `  function f${i}() { return s; }\n`)),
  "rc-constants-used-before.jsx": n =>
    component(seq(n, i => `  const g${i} = () => c${i};\n`) + seq(n, i => `  const c${i} = s;\n`)),
  // ── hooks ──
  "rc-states.jsx": n => component(seq(n, i => `  const [a${i}, b${i}] = useState(${i});\n`)),
  "rc-hooks-in-conditions.jsx": n => component(seq(n, i => `  if (props.a) { useState(${i}); }\n`)),
  "rc-reads-of-a-ref.jsx": n => component("  const r = useRef(null);\n" + rep("  r.current;\n", n)),
  "rc-refs.jsx": n => component(seq(n, i => `  const r${i} = useRef(null); r${i}.current;\n`)),
  "rc-set-state-in-render.jsx": n => component(rep("  setS(1);\n", n)),
  "rc-effects.jsx": n => component(rep("  useEffect(() => { setS(1); }, []);\n", n)),
  "rc-missing-effect-dependencies.jsx": n =>
    component(seq(n, i => `  const d${i} = props.a${i};\n`) + `  useEffect(() => { ${seq(n, i => `d${i};`)} }, []);`),
  "rc-memos.jsx": n => component(seq(n, i => `  const m${i} = useMemo(() => s + ${i}, [s]);\n`)),
  "rc-missing-memo-dependencies.jsx": n =>
    component(
      seq(n, i => `  const d${i} = props.a${i};\n`) + `  const m = useMemo(() => [${seq(n, i => `d${i}`, ",")}], []);`,
    ),
  "rc-callbacks.jsx": n => component(seq(n, i => `  const c${i} = useCallback(() => s + ${i}, [s]);\n`)),
  // ── functions in the function ──
  "rc-closures.jsx": n => component(seq(n, i => `  const f${i} = () => s + ${i};\n`)),
  "rc-closure-chain.jsx": n =>
    component("  const f0 = () => s;\n" + seq(n, i => `  const f${i + 1} = () => f${i}();\n`)),
  "rc-components-in-render.jsx": n =>
    component(
      seq(n, i => `  const C${i} = () => <a />;\n`),
      `<a>${seq(n, i => `<C${i} />`)}</a>`,
    ),
  // ── what is mutated, and through what ──
  "rc-mutations.jsx": n => component("  const o = {};\n" + seq(n, i => `  o.a${i} = s;\n`)),
  "rc-mutations-of-props.jsx": n => component(seq(n, i => `  props.a${i} = s;\n`)),
  "rc-aliases.jsx": n =>
    component("  const o0 = {};\n" + seq(n, i => `  const o${i + 1} = o${i};\n`) + `  o${n}.x = 1;`),
  "rc-captures.jsx": n =>
    component(seq(n, i => `  const o${i} = {};\n`) + `  const f = () => { ${seq(n, i => `o${i}.x = 1;`)} }; f();`),
  // ── what is reported once for each ──
  "rc-new-dates.jsx": n => component(rep("  new Date();\n", n)),
  "rc-randoms.jsx": n => component(rep("  Math.random();\n", n)),
  "rc-implicit-arguments.jsx": n => component(rep("  arguments;\n", n)),
  "rc-globals.jsx": n => component(seq(n, i => `  g${i} = s;\n`)),
  "rc-capitalized-calls.jsx": n => component(seq(n, i => `  Foo${i}();\n`)),
  // ── functions of the file ──
  "rc-components.jsx": components,
  "rc-components-in-a-function.jsx": n => `function outer() {\n${components(n)}}\n`,
  "rc-components-in-memo.jsx": n => seq(n, i => `const C${i} = memo((props) => { useState(0); return <a />; });\n`),
  // Each comment is reported for each component.
  "rc-suppressions-and-components.jsx": n =>
    rep("/* eslint-disable react-hooks/rules-of-hooks */\n", n) + components(n),
  "rc-suppressions-of-a-line.jsx": n =>
    component(rep("  // eslint-disable-next-line react-hooks/rules-of-hooks\n  s;\n", n)),
};

const deepShapes: Record<string, (n: number) => string> = {
  // ── statements ──
  "rc-blocks.jsx": n => component(`${rep("{", n)}s;${rep("}", n)}`),
  "rc-ifs.jsx": n => component(`${rep("if (props.a) {", n)}s;${rep("}", n)}`),
  "rc-else-ifs.jsx": n => component(seq(n, i => `if (props.a${i}) { s; } else `) + "{ s; }"),
  "rc-whiles.jsx": n => component(`${rep("while (props.a) {", n)}s;${rep("}", n)}`),
  "rc-trys.jsx": n => component(`${rep("try {", n)}s;${rep("} catch (e) {}", n)}`),
  "rc-switches.jsx": n => component(`${rep("switch (props.a) { case 1: ", n)}s;${rep("}", n)}`),
  "rc-labels.jsx": n => component(seq(n, i => `l${i}: `) + "{ s; }"),
  "rc-same-name-in-blocks.jsx": n => component(`${rep("{ const a = s; ", n)}a;${rep("}", n)}`),
  // ── functions ──
  "rc-arrows.jsx": n => component(`const f = ${seq(n, i => `(a${i}) => `)}s;`),
  "rc-functions.jsx": n => component(seq(n, i => `function f${i}() {`) + "s;" + rep("}", n)),
  "rc-called-arrows.jsx": n => component(`const x = ${rep("(() => ", n)}s${rep(")()", n)};`),
  "rc-classes.jsx": n => component(`const x = ${rep("class { m() { return ", n)}s${rep("} }", n)};`),
  "rc-memos.jsx": n => component(`const x = ${rep("useMemo(() => ", n)}s${rep(", [s])", n)};`),
  "rc-effects.jsx": n => component(`${rep("useEffect(() => {", n)}setS(1);${rep("}, []);", n)}`),
  // ── expressions ──
  "rc-calls.jsx": n => component(`const x = ${rep("f(", n)}s${rep(")", n)};`),
  "rc-news.jsx": n => component(`const x = ${rep("new F(", n)}s${rep(")", n)};`),
  "rc-parentheses.jsx": n => component(`const x = ${rep("(", n)}s${rep(")", n)};`),
  "rc-arrays.jsx": n => component(`const x = ${rep("[", n)}s${rep("]", n)};`),
  "rc-spreads.jsx": n => component(`const x = ${rep("[...", n)}s${rep("]", n)};`),
  "rc-objects.jsx": n => component(`const x = ${rep("{a:", n)}s${rep("}", n)};`),
  "rc-conditionals.jsx": n => component(`const x = ${rep("props.a ? s : ", n)}s;`),
  "rc-conditionals-in-the-test.jsx": n => component(`const x = ${rep("(", n)}s${rep(" ? s : s)", n)};`),
  "rc-unary.jsx": n => component(`const x = ${rep("!", n)}s;`),
  "rc-assignments.jsx": n => component(`let a; const x = ${rep("a = ", n)}s;`),
  "rc-templates.jsx": n => component("const x = " + rep("`${", n) + "s" + rep("}`", n) + ";"),
  "rc-awaits.jsx": n =>
    `async function Component(props) { useState(0); const x = ${rep("await ", n)}props; return <div />; }\n`,
  "rc-as.tsx": n => component(`const x = s${rep(" as any", n)};`),
  "rc-non-null.tsx": n => component(`const x = s${rep("!", n)};`),
  // ── JSX and patterns ──
  "rc-jsx.jsx": n => component("", `${rep("<a>", n)}{s}${rep("</a>", n)}`),
  "rc-jsx-in-attributes.jsx": n => component("", `${rep("<a b={", n)}s${rep("} />", n)}`),
  "rc-array-patterns.jsx": n => component(`const ${rep("[", n)}a${rep("]", n)} = props;`),
  "rc-object-patterns.jsx": n => component(`const ${rep("{a:", n)}b${rep("}", n)} = props;`),
};

const shapesOf = (shapes: Record<string, (n: number) => string>, n: number) =>
  lazily(Object.fromEntries(Object.entries(shapes).map(([name, make]) => [name, () => make(n)])));

export const wide = (n: number) => shapesOf(wideShapes, n);
export const deep = (n: number) => shapesOf(deepShapes, n);

const rules = Object.fromEntries(RULE_NAMES.map(rule => [rule, "error"]));

/** It is compiled, in a small part of a second. The sizes are about half of what is refused, or less. */
const compiled = (name: string, text: () => string, reports: Record<string, number> = {}): Case => ({
  name: `a component with ${name}`,
  file: "a.jsx",
  text,
  rules,
  reports,
  exitCode: Object.keys(reports).length > 0 ? 1 : 0,
});

const heavy = (it: Case): Case => ({ ...it, isHeavy: true });

/** It would take minutes or gigabytes to compile, or overflow the stack. */
const refused = (name: string, text: () => string): Case => ({
  name: `a component with ${name} is not compiled`,
  file: "a.jsx",
  text,
  rules,
  reports: { "react/todo": 1 },
  matches: /Support functions of this size/,
  exitCode: 1,
});

/** The same, with the reason: how deep is too deep depends on the stack that is left, but this is in every build. */
const tooDeep = (name: string, text: () => string): Case => ({
  name: `a component with ${name} is not compiled`,
  file: "a.jsx",
  text,
  rules,
  args: ["-f", "json"],
  matches:
    /^\{ "diagnostics": \[\{"message": "Support functions of this size","code": "react\(todo\)",.*"help": "What is in it is nested too deeply",.*\}\],$/m,
  exitCode: 1,
});

export const cases: Case[] = [
  compiled("a call that has 48 arguments", () => wideShapes["rc-arguments-of-a-call.jsx"](48)),
  refused("a call that has 20,000 arguments", () => wideShapes["rc-arguments-of-a-call.jsx"](20_000)),
  heavy(compiled("a variable that 250 ifs assign", () => wideShapes["rc-one-phi.jsx"](250))),
  refused("a variable that 20,000 ifs assign", () => wideShapes["rc-one-phi.jsx"](20_000)),
  heavy(compiled("150 for-of loops", () => wideShapes["rc-for-of.jsx"](150))),
  refused("20,000 for-of loops", () => wideShapes["rc-for-of.jsx"](20_000)),
  heavy(compiled("a pattern that has 150 defaults", () => wideShapes["rc-pattern-defaults.jsx"](150))),
  refused("a pattern that has 20,000 defaults", () => wideShapes["rc-pattern-defaults.jsx"](20_000)),
  heavy(compiled("250 blocks that declare the same name", () => wideShapes["rc-same-name-in-blocks.jsx"](250))),
  refused("20,000 blocks that declare the same name", () => wideShapes["rc-same-name-in-blocks.jsx"](20_000)),
  heavy(compiled("250 try statements", () => wideShapes["rc-trys.jsx"](250))),
  refused("20,000 try statements", () => wideShapes["rc-trys.jsx"](20_000)),
  heavy(compiled("300 new Date()", () => wideShapes["rc-new-dates.jsx"](300), { "react/purity": 300 })),
  refused("20,000 new Date()", () => wideShapes["rc-new-dates.jsx"](20_000)),
  compiled("250 closures", () => wideShapes["rc-closures.jsx"](250)),
  refused("20,000 closures", () => wideShapes["rc-closures.jsx"](20_000)),
  compiled("250 useMemo", () => wideShapes["rc-memos.jsx"](250)),
  refused("20,000 useMemo", () => wideShapes["rc-memos.jsx"](20_000)),
  // A debug build has frames ten times as large, and refuses what is a tenth as deep.
  compiled("ifs 8 deep", () => deepShapes["rc-ifs.jsx"](8)),
  heavy(compiled("ifs 60 deep", () => deepShapes["rc-ifs.jsx"](60))),
  tooDeep("ifs 1,000 deep", () => deepShapes["rc-ifs.jsx"](1_000)),
  compiled("JSX 15 deep", () => deepShapes["rc-jsx.jsx"](15)),
  heavy(compiled("JSX 100 deep", () => deepShapes["rc-jsx.jsx"](100))),
  tooDeep("JSX 1,000 deep", () => deepShapes["rc-jsx.jsx"](1_000)),
  heavy(compiled("a sum of 100", () => wideShapes["rc-binary.jsx"](100))),
  tooDeep("a sum of 20,000", () => wideShapes["rc-binary.jsx"](20_000)),
  heavy(compiled("a chain of 100 properties", () => wideShapes["rc-dots.jsx"](100))),
  tooDeep("a chain of 20,000 properties", () => wideShapes["rc-dots.jsx"](20_000)),
  { ...compiled("", () => components(1_000)), name: "1,000 components", isHeavy: true },
  {
    ...compiled("", () => wideShapes["rc-suppressions-and-components.jsx"](60), { "react/rule-suppression": 3_600 }),
    name: "60 comments that disable the rules of hooks, each reported for each of 60 components",
  },
  {
    // 160,000, of which not all are reported.
    name: "400 comments that disable the rules of hooks and 400 components",
    isHeavy: true,
    file: "a.jsx",
    text: () => wideShapes["rc-suppressions-and-components.jsx"](400),
    rules,
    matches: /\[Error\/react\/rule-suppression\]$/m,
    exitCode: 1,
  },
];
