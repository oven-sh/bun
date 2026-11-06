// The inputs of ../../react-compiler.test.ts, which expected.ts also runs through oxlint and ESLint. Each one is a
// directory of files that's linted in one run with no arguments except `-f json`. The inputs that weren't written for
// this test are in expected.json.

import { ESLINT_ONLY, RULE_NAMES, RULES } from "./shared.ts";

/** Returns an `.oxlintrc.json` with only `rules` enabled. */
export const rc = (rules: readonly string[] = RULE_NAMES) =>
  JSON.stringify({
    plugins: ["react"],
    categories: { correctness: "off" },
    rules: Object.fromEntries(rules.map(rule => [rule, "error"])),
  });

export type Files = Record<string, string>;

const readsRef = (comment: string) => `function Component() {
  const ref = useRef(null);
  ${comment}
  const value = ref.current;
  return <div>{value}</div>;
}
`;

/** The first label is the call, the second is the effect. */
const setsState = (beforeEffect: string, beforeCall: string) => `function Component() {
  const [state, setState] = useState(0);${beforeEffect}
  useEffect(() => {${beforeCall}
    setState(1);
  }, []);
  return <div>{state}</div>;
}
`;

export const twoLabels = setsState("", "");

const comments: Files = { ".oxlintrc.json": rc() };
for (const tool of ["eslint", "oxlint"]) {
  for (const name of ["react/refs", "react-hooks/refs", "react_hooks/refs", "refs", "react/purity"]) {
    comments[`${tool}/${name.replace("/", ".")}.jsx`] = readsRef(`// ${tool}-disable-next-line ${name}`);
  }
}
Object.assign(comments, {
  "every-rule.jsx": readsRef("// eslint-disable-next-line"),
  "same-line.jsx": readsRef("").replace("ref.current;", "ref.current; // eslint-disable-line react/refs"),
  "until-enabled.jsx": `/* eslint-disable react-hooks/refs */\n${readsRef("")}/* eslint-enable react-hooks/refs */\n${readsRef("").replace("Component", "Other")}`,
  "in-jsx.jsx": `function Component() {
  const ref = useRef(null);
  return (
    <div>
      {/* eslint-disable-next-line react/refs */}
      {ref.current}
    </div>
  );
}
`,
  "before-the-first-label.jsx": setsState("", "\n    // eslint-disable-next-line react/set-state-in-effect"),
  "before-the-second-label.jsx": setsState("\n  // eslint-disable-next-line react/set-state-in-effect", ""),
});

const notReact = (directive: string) => `export function compute(props) {${directive}
  props.value = Date.now();
  return props.value + Math.random();
}
`;

const severalRules = `function Component(props) {
  const ref = useRef(null);
  try {
    props.load();
  } finally {
    props.done();
  }
  const value = ref.current;
  props.items = [];
  return <div>{value}</div>;
}

function useThing(props) {
  props.x = 10;
  if (props.cond) later();
  return useOther({});

  function later() {
    return 5;
  }
}

function Clock() {
  return <div>{Date.now()}</div>;
}
`;

const impure = "function Component() {\n  return <div>{Date.now()}</div>;\n}\n";

/** oxlint's compiler treats `for (;;)` as `while (true)`. Upstream's reports a Todo for it. */
const forever = `import { useRef } from "react";

export function Forever(props: { a: number }) {
  const ref = useRef(0);
  const bad = ref.current;
  for (;;) {
    if (props.a) break;
  }
  return <div>{bad}</div>;
}

export function Counts(props: { a: number }) {
  let last = 0;
  for (let i = 0; ; i++) {
    if (i > props.a) break;
    last = i;
  }
  props.a = last;
  return <div>{last}</div>;
}

export function Alone(props: { a: number }) {
  for (;;) {
    if (props.a) break;
  }
  return <div>{props.a}</div>;
}
`;

/** `x = d` in a pattern has its own source location, and the value it produces gets that location. */
const defaults = `import { useState } from "react";

function useDefaultThing(): number {
  return useState(0)[0];
}

export function InAnObject({ label, useThing = useDefaultThing }: { label: string; useThing?: () => number }) {
  const v = useThing();
  return <p>{label}{v}</p>;
}

export function WithAKey({ hook: useThing = useDefaultThing }: { hook?: () => number }) {
  return <p>{useThing()}</p>;
}

export function InAnArray([useThing = useDefaultThing]: [(() => number)?]) {
  return <p>{useThing()}</p>;
}

export function useParameter(useThing = useDefaultThing) {
  return useThing();
}

export function InTheBody(props: { useThing?: () => number }) {
  const { useThing = useDefaultThing } = props;
  return <p>{useThing()}</p>;
}
`;

/** What's reported for `a = a + 1` depends on the order in which the compiler visits the loops' blocks. */
const order = `export default function Component(props) {
  let a = props.a,
    b = 0,
    c = null,
    d = 0,
    e = {};
  try {
  } catch {}
  const g1 = (p2) => {
    const h3 = (q4) => {};
    const t5 = <b x={(b = !b)}>{b}</b>;
    try {
      ({ [a]: 1 });
    } catch (err) {}
    {
    }
    {
    }
    {
    }
  };
  while (e.m0) {
    try {
    } catch (err) {}
    do {
      c = {} + (0 && <b x={g1}>{e}</b>);
      v6 = {};
      c = {};
      try {
      } catch (err) {}
    } while ({});
    const o8 = {};
    const g9 = () => {};
  }
  for (const x12 of props.x) {
    try {
      try {
        if (f0) {
          switch (g1) {
            default: {
            }
            case 0: {
            }
            case 1: {
            }
            case 2: {
              {
              }
              const g19 = () => {
                a = a + 1;
              };
              g19();
            }
          }
        }
        const o22 = {};
      } catch (e2) {}
      try {
      } catch {}
    } catch (err) {}
  }
  return (
    <div>
      {a}
      {b}
      {c}
      {d}
      {e}
    </div>
  );
}
`;

/**
 * oxc's compiler keeps each effect's own location. Upstream's uses the first write to a captured variable in place of
 * the later ones.
 */
const writes = `export default function Component(props) {
  let a = props.a;
  const read = () => a;
  const element = <div onClick={read}>{props.b}</div>;
  a = 1;
  if (props.c) {
    a = [a, 2];
  }
  a = 3;
  return element;
}
`;

/** These aren't React's hooks, despite their names. */
const ownHooks = `export function Component(props) {
  const f = useCallback(() => [props.a()], [props.a()]);
  const m = useMemo(() => [props.a()], [props.a()]);
  return <div onClick={f}>{m}</div>;
}

function useCallback<T>(callback: T, dependencies?: Array<unknown>): T {
  return callback;
}

const useMemo = <T,>(callback: () => T, dependencies?: Array<unknown>): T => callback();
`;

/** `React.useMemo` counts as React's because of the name `React`, no matter where it's imported from. */
const reactByItsName = `import React from "other";
import * as R from "react";

export function ByItsName(props) {
  const m = React.useMemo(() => [props.a()], [props.a()]);
  return <p>{m}</p>;
}

export function ByAnotherName(props) {
  const m = R.useMemo(() => [props.a()], [props.a()]);
  return <p>{m}</p>;
}
`;

/**
 * Two tags of the same kind in one `<fbt>`, at any depth. It's reported in addition to the function's other
 * diagnostics. The plugin also counts an attribute's name.
 */
const duplicateFbtTags = `function Both(props) {
  var x = 1;
  return (
    <fbt desc="d">
      <fbt:plural count={props.a} many="items">item</fbt:plural>
      <fbt:param name="n">{props.l.map(i => <fbt:plural count={i} many="things">thing</fbt:plural>)}</fbt:param>
      {x}
    </fbt>
  );
}

function OfAnotherTag(props) {
  return (
    <fbs desc="d">
      <fbs:pronoun type="subject" gender={props.a} />
      <fbs:enum enum-range={["a"]} value={props.c} />
      <fbt:enum enum-range={["a"]} value={props.c} />
    </fbs>
  );
}

function AnAttribute(props) {
  return (
    <fbt desc="d">
      <fbt:plural count={props.a} many="items">item</fbt:plural>
      <div fbt:plural="x" />
    </fbt>
  );
}
`;

/** `map` doesn't retain its arguments, so the callback doesn't get its own scope, which would depend on `i18n`. */
const callbackOfMap = `import { useMemo } from "react";
export function Component({ nodes, i18n }) {
  const grouped = useMemo(() => {
    const groups = [];
    for (const node of nodes) {
      groups.push(node);
    }
    return groups.map(key => format(key).locale(i18n.language));
  }, [nodes, i18n.language]);
  return <div>{grouped}</div>;
}
`;

/** JSX can't be evaluated earlier, and neither can an expression that contains JSX. */
const defaultsWithJsx = `export function A({ icon = { on: <Eye />, off: <Off /> } }) {
  return <div>{icon.on}</div>;
}

export function B({ Empty = () => <div /> }) {
  return <Empty />;
}

export function C({ icon = <Eye /> }) {
  return <div>{icon}</div>;
}

export function D({ icon = { on: 1 } }) {
  return <div>{icon.on}</div>;
}

export function E({ icon = [<Eye />] }) {
  return <div>{icon}</div>;
}

export function F({ text = css\`a\` }) {
  return <div>{text}</div>;
}
`;

/** Reads a ref during render at the top, followed by `n` copies of `unit`. */
export const long = (
  n: number,
  unit: (k: number) => string,
  result: (units: string) => [body: string, returns: string],
) => {
  const [body, returns] = result(Array.from({ length: n }, (_, k) => unit(k)).join("\n"));
  return `import { useCallback, useRef, useState } from "react";

export function Long(props: { a: number }) {
  const ref = useRef(0);
  const bad = ref.current;
${body}
  return ${returns};
}
`;
};

/** The compiler lowers a type cast to its own instruction, with its own location. It doesn't for `x!`. */
const casts = `function Hidden(props: Props) {
  const Dynamic = useComponent(props.kind) as any;
  const Plain = useComponent(props.kind);
  return (
    <div>
      <Dynamic />
      <Plain />
    </div>
  );
}

function Mutates(props: Props) {
  (props as any).value = 1;
  return <div />;
}

function Passes(props: Props) {
  const ref = useRef(null);
  const value = read({ ref } as Options);
  const current = ref.current as number;
  return <div>{value}{current}</div>;
}

function Depends(props: Props) {
  const value = useMemo(() => compute(props.a), [(props as any).a]);
  return <div>{value}</div>;
}

function Twice(props: Props) {
  ((props as unknown) as Mutable).value = 1;
  return <div />;
}

function NotNull(props: Props) {
  props.other!.value = 2;
  return <div />;
}
`;

/** The small input directories, keyed by test name. */
export const small: Record<string, Files> = {
  comments,
  "not React": {
    ".oxlintrc.json": rc(),
    // Nothing here creates JSX or calls a hook, and nothing is named like a component or a hook.
    "plain.js": notReact(""),
    "class.js": "export class Component {\n  render() {\n    this.props.a = Date.now();\n    return null;\n  }\n}\n",
    // The same function, opted in with 'use memo'.
    "asked-for.js": notReact("\n  'use memo';"),
  },
  todo: {
    ".oxlintrc.json": rc([]),
    "on/.oxlintrc.json": rc(),
    "on/a.jsx": severalRules,
    "off/.oxlintrc.json": rc(RULE_NAMES.filter(rule => rule !== "react/todo")),
    "off/a.jsx": severalRules,
    "alone/.oxlintrc.json": rc(["react/todo"]),
    "alone/a.jsx": severalRules,
  },
  // Code that oxc's fork of the compiler accepts, or reports differently, unlike the compiler in Bun.
  fork: {
    ".oxlintrc.json": rc(),
    // The `useMemo` callback counts as part of the component.
    "ref-in-memo.jsx": `function Component(props) {
  const ref = useRef(null);
  const value = useMemo(() => compute(ref), [props.a]);
  const other = (() => compute(ref))();
  return <div>{value}{other}</div>;
}
`,
    // A value that another callback captures isn't an operand of the call.
    "ref-in-callback.jsx": `function Row() {
  const pending = useRef(null);
  const handle = rating => {
    pending.current = rating;
  };
  return [1, 2].map(rating => <Pressable onPress={() => handle(rating)} />);
}

function Brush() {
  const drag = useRef(null);
  const begin = mode => e => {
    drag.current = mode;
  };
  return <div onPointerDown={begin("end")} />;
}
`,
    "parameter.jsx": `function Component({ loading, x }) {
  const read = () => loading;
  if (x) {
    loading = true;
  }
  return <div onClick={read}>{loading}</div>;
}
`,
    "literals.jsx": `function Component(props) {
  const big = 10n;
  const className = css\`color: \${props.color};\`;
  const raw = String.raw\`a\\_b\`;
  return <div className={className}>{String(big)}{raw}</div>;
}
`,
    "import.jsx": `let cached;

function Component(props) {
  const load = async () => {
    const module = await import("./module");
    cached ??= import("./other");
    return module;
  };
  return <div onClick={load} />;
}
`,
    "catch.jsx": `function Component(props) {
  const [error, setError] = useState(null);
  useEffect(() => {
    try {
      props.load();
    } catch (thrown) {
      setError(() => thrown);
    }
  });
  return <div>{error}</div>;
}
`,
    "own-name.jsx": `function Component(props) {
  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      props.draw();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  });
  return <div />;
}
`,
    "own-name-of-the-component.jsx": `import { memo, useRef } from "react";

export default memo(function Tree({ items }) {
  const ref = useRef(0);
  const bad = ref.current;
  return <div>{bad}{items.map(item => <Tree key={item.id} items={item.items} />)}<Tree items={[]} /></div>;
});
`,
    // oxc's AST has a node for parentheses.
    "parentheses.tsx": `import { useRef } from "react";

export function Left(props) {
  const ref = useRef(null);
  const a = (props.a && ref.current?.height) || 0;
  const b = (ref.current?.width as number) ?? 0;
  const c = ref.current?.depth as number || 0;
  return <div>{a}{b}{c}</div>;
}

export function Defaults({ a = (<Eye />), b = props.x as any, c = (1), d = [(1)] }) {
  return <div>{a}{b}{c}{d}</div>;
}
`,
    // The tag function is called on every evaluation.
    "tagged-template.jsx": `import { useMemo } from "react";

export function Component() {
  const text = useMemo(() => t\`No country\`, []);
  return <F text={text} />;
}
`,
    // The fork reports this at the first function. Upstream reports it at the unreachable block's first instruction,
    // which is the hoisted declaration of `second`.
    "unreachable.jsx": `function Component(props) {
  return <div>{first()}</div>;

  function first() {
    return second();
  }

  function second() {
    return props.a;
  }
}
`,
    // Upstream throws an invariant for both. The fork destructures through temporaries if the captured variable has a
    // key.
    "captured-target.jsx": `export function WithAKey(props) {
  let a = [];
  let b = [];
  ({ r: a, b } = props.q());
  const g = () => a;
  return <div onClick={g}>{b}</div>;
}

export function Shorthand(props) {
  let a = [];
  let b = [];
  ({ a, b } = props.q());
  const g = () => a;
  return <div onClick={g}>{b}</div>;
}
`,
    "computed-string.jsx": `import { useRef } from "react";

export function Component({ ["data-testid"]: testId, a }) {
  const ref = useRef(0);
  const bad = ref.current;
  return <div data-testid={testId}>{a}{bad}</div>;
}
`,
    "default.jsx": `function Component({ icon = <Icon />, empty = <></>, either = props.a || other() }) {
  return <div>{icon}{empty}{either}</div>;
}
`,
    "update.jsx": `let count = 0;

test("counts", () => {
  let renders = 0;
  function Component() {
    renders++;
    count++;
    return <div />;
  }
  render(<Component />);
});
`,
    "clock.jsx": `function Component() {
  const now = new Date();
  const text = Date();
  const then = new Date(0);
  return <div>{now.getTime()}{text}{then.getTime()}</div>;
}
`,
    "arguments.jsx": `function Component() {
  return <div>{arguments.length}</div>;
}
`,
    "virtual.jsx": `import { useWindowVirtualizer } from "@tanstack/react-virtual";

function Component(props) {
  const virtualizer = useWindowVirtualizer({ count: props.count });
  return <div>{virtualizer.getTotalSize()}</div>;
}
`,
  },
  casts: { ".oxlintrc.json": rc(), "casts.tsx": casts },
  long: {
    ".oxlintrc.json": rc(),
    "statements.tsx": long(
      2000,
      k => `  const v${k} = props.a + ${k};`,
      units => [units, "<div>{bad + v0 + v1999}</div>"],
    ),
    "states.tsx": long(
      1000,
      k => `  const [s${k}, setS${k}] = useState(${k});`,
      units => [units, "<div>{bad + s0 + s999 + (setS0 === setS999 ? 0 : 1)}</div>"],
    ),
    "callbacks.tsx": long(
      2000,
      k => `  const f${k} = useCallback(() => props.a + ${k}, [props.a]);`,
      units => [units, "<div>{bad + f0() + f1999()}</div>"],
    ),
    "children.tsx": long(
      2000,
      k => `      <span>{props.a + ${k}}</span>`,
      units => ["", `(\n    <div>\n      {bad}\n${units}\n    </div>\n  )`],
    ),
  },
  order: { ".oxlintrc.json": rc(), "order.jsx": order },
  writes: { ".oxlintrc.json": rc(), "writes.jsx": writes },
  names: {
    ".oxlintrc.json": rc(),
    "own-hooks.tsx": ownHooks,
    "defaults-with-jsx.jsx": defaultsWithJsx,
    "react-by-its-name.jsx": reactByItsName,
    "fbt.jsx": duplicateFbtTags,
    "callback-of-map.jsx": callbackOfMap,
  },
  lowering: { ".oxlintrc.json": rc(), "forever.tsx": forever, "defaults.tsx": defaults },
  node_modules: {
    ".oxlintrc.json": rc(),
    "a.jsx": impure,
    "node_modules/package/a.jsx": impure,
    "vendor/node_modules/package/a.jsx": impure,
    // `node_modules` only has to be a substring of the path.
    "src/not_node_modules/a.jsx": impure,
  },
};

type RawDiagnostic = { filename?: string; url?: string; [key: string]: unknown };

/** Returns the same value with every object's keys sorted. */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
  return Object.fromEntries(entries.map(([key, item]) => [key, ordered(item)]));
}

/**
 * Groups a `-f json` report's diagnostics by file. Drops the filename and the rule's docs URL, and sorts them so the
 * order doesn't depend on the tool.
 */
export function byFile(report: { diagnostics: RawDiagnostic[] }): Record<string, unknown[]> {
  const files = new Map<string, string[]>();
  for (const { filename = "", url, ...diagnostic } of report.diagnostics) {
    const path = filename.replaceAll("\\", "/");
    if (!files.has(path)) files.set(path, []);
    files.get(path)!.push(JSON.stringify(ordered(diagnostic)));
  }
  const sorted = [...files].sort(([a], [b]) => (a < b ? -1 : 1));
  return Object.fromEntries(sorted.map(([path, found]) => [path, found.sort().map(it => JSON.parse(it))]));
}

// ── ESLint, with eslint-plugin-react-hooks ──

/** The plugin's compiler rules. */
export const ESLINT_RULES = [
  ...RULES.map(([rule]) => `react-hooks/${rule}`),
  ...ESLINT_ONLY.map(([rule]) => `react-hooks/${rule}`),
  "react-hooks/component-hook-factories",
];

/** An `eslint.config.js`. It only names the plugin and typescript-eslint's parser, which are built in to `bun lint`. */
export const eslintConfig = `export default [
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: { "react-hooks": { meta: { name: "eslint-plugin-react-hooks" } } },
    rules: ${JSON.stringify(Object.fromEntries(ESLINT_RULES.map(rule => [rule, "error"])))},
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  { files: ["**/*.{ts,tsx}"], languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } } } },
];
`;

const extraDependency = (parameters: string) => `function Component(${parameters}) {
  const value = useMemo(() => [a], [a, b]);
  return <div>{value}</div>;
}
`;

export const eslintSmall: Files = {
  // The plugin parses `.ts` and `.tsx` files with Babel, which records the filename and each node's offsets.
  "typescript.tsx": extraDependency("{ a, b }: { a: number; b: number }"),
  // It parses everything else with Hermes, which records neither, so there's no filename line and no suggestion that
  // needs the dependency list's offsets.
  "javascript.jsx": extraDependency("{ a, b }"),
  // A location that spans more than ten lines.
  "long.jsx": `function Component(props) {
  let value = 0;
  try {
${["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(name => `    value += props.${name};\n`).join("")}  } finally {
    props.done();
  }
  return <div>{value}</div>;
}
`,
  "casts.tsx": casts,
  "defaults.tsx": defaults,
  "writes.jsx": writes,
  "own-hooks.tsx": ownHooks,
  "defaults-with-jsx.jsx": defaultsWithJsx,
  "react-by-its-name.jsx": reactByItsName,
  "fbt.jsx": duplicateFbtTags,
  "callback-of-map.jsx": callbackOfMap,
  "disabled.jsx": readsRef("// eslint-disable-next-line react-hooks/refs"),
  "flow-hook.jsx": readsRef("// $FlowFixMe[react-rule-hook]"),
  "flow-ref.jsx": readsRef("// $FlowFixMe[react-rule-unsafe-ref]"),
  "flow-other.jsx": readsRef("// $FlowFixMe[other]"),
  // typescript-eslint parses it. Babel, with the plugin's options, doesn't.
  "decorator.tsx": `@sealed\nclass Store {}\n\n${readsRef("")}`,
  // No function is named like a component or a hook, so the plugin doesn't compile anything.
  "memo.jsx": `export default memo(props => {
  const ref = useRef(null);
  const value = ref.current;
  return <div>{value}</div>;
});
`,
};

type EslintMessage = {
  ruleId: string | null;
  severity: number;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  suggestions?: { desc: string; fix: { range: [number, number]; text: string } }[];
};
type EslintResult = { filePath: string; messages: EslintMessage[]; suppressedMessages: EslintMessage[] };

/**
 * Groups ESLint's `-f json` results by file, for files with messages (including suppressed ones). Paths are made
 * relative to one of `directories`, which becomes `<dir>` in message text.
 */
export function byEslintFile(results: EslintResult[], directories: string[]) {
  const inside = (path: string) => {
    const directory = directories.find(it => path.startsWith(it));
    return directory === undefined ? null : path.slice(directory.length + 1).replaceAll("\\", "/");
  };
  const plain = (it: EslintMessage) => ({
    ruleId: it.ruleId,
    severity: it.severity,
    // The line above a code frame: `path:line:column`.
    message: it.message.replace(/^.+(?=:\d+:\d+$)/gm, path => (inside(path) === null ? path : `<dir>/${inside(path)}`)),
    line: it.line,
    column: it.column,
    endLine: it.endLine,
    endColumn: it.endColumn,
    suggestions: (it.suggestions ?? []).map(({ desc, fix }) => ({ desc, range: fix.range, text: fix.text })),
  });
  const files: Record<string, { messages: ReturnType<typeof plain>[]; suppressed: ReturnType<typeof plain>[] }> = {};
  for (const { filePath, messages, suppressedMessages } of results) {
    if (messages.length + suppressedMessages.length === 0) continue;
    files[inside(filePath) ?? filePath] = { messages: messages.map(plain), suppressed: suppressedMessages.map(plain) };
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Reduces each message to its rule, location and first line. */
export const briefly = (files: ReturnType<typeof byEslintFile>) =>
  Object.fromEntries(
    Object.entries(files).map(([path, { messages }]) => [
      path,
      messages.map(
        it => `${it.ruleId} ${it.line}:${it.column}-${it.endLine}:${it.endColumn} ${it.message.split("\n")[0]}`,
      ),
    ]),
  );
