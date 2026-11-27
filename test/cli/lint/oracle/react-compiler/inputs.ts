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

// ── What oxlint 1.95 reports differently from 1.87 ──

/**
 * oven-sh/bun#49620. A component that's declared inside another function. The file is only compiled if `rest` has a
 * component or a hook at the top level.
 */
const nested = (rest: string) => `import { useState } from "react";

export function setup() {
  const held: { value?: number } = {};
  function Harness() {
    held.value = useState(1)[0];
    return null;
  }
  return { held, Harness };
}
${rest}`;

const nestedComponents: Files = {
  ".oxlintrc.json": rc(),
  "in-a-function.tsx": nested(""),
  "in-a-test.tsx": `import { useState } from "react";

test("renders", () => {
  let seen = 0;
  const Harness = () => {
    seen = useState(1)[0];
    return <p>{seen}</p>;
  };
  render(<Harness />);
  expect(seen).toBe(1);
});
`,
  "in-a-describe.tsx": `import { useRef } from "react";

describe("a hook", () => {
  it("reads a ref", () => {
    function useProbe() {
      const ref = useRef(0);
      return ref.current;
    }
    expect(renderHook(useProbe)).toBe(0);
  });
});
`,
  "beside-a-component.tsx": nested("\nexport function App() {\n  return null;\n}\n"),
  "beside-a-hook.ts": nested("\nexport const useHeld = () => setup().held;\n"),
  "beside-a-helper.tsx": nested("\nexport function helper() {\n  return setup();\n}\n"),
};

/**
 * oven-sh/bun#49621. A callback reads `x.current` when it runs, not during render, so it depends on `x` even if the
 * compiler doesn't know that `x` is a ref.
 */
const refArguments: Files = {
  ".oxlintrc.json": rc(),
  "typed.ts": `import { useCallback, useLayoutEffect, type RefObject } from "react";

export function useSyncHeight(
  field: RefObject<HTMLElement | null>,
  sizer: RefObject<HTMLElement | null>,
  text: string,
): void {
  const fit = useCallback(() => {
    const box = field.current;
    const measured = sizer.current;
    if (box === null || measured === null) return;
    box.style.setProperty("--text-height", getComputedStyle(measured).height);
  }, [field, sizer]);

  useLayoutEffect(fit, [fit, text]);
}
`,
  "untyped.ts": `import { useCallback } from "react";

export function useSync(field) {
  const fit = useCallback(() => {
    return field.current;
  }, [field]);
  return fit;
}
`,
  "named-like-a-ref.ts": `import { useCallback, type RefObject } from "react";

export function useSync(fieldRef: RefObject<HTMLElement | null>) {
  const fit = useCallback(() => {
    return fieldRef.current;
  }, [fieldRef]);
  return fit;
}
`,
  "prop.tsx": `import { useCallback } from "react";

export function Field({ field }) {
  const fit = useCallback(() => {
    return field.current;
  }, [field]);
  return <div onClick={fit} />;
}
`,
  "after-nullish.jsx": `import { useEffect, useRef } from "react";

export function Forwarded({ forwardedRef }) {
  const ownRef = useRef(null);
  const target = forwardedRef ?? ownRef;
  const report = () => {
    console.log(target.current.tagName);
  };
  useEffect(report);
  return <div ref={target} />;
}
`,
  "in-an-effect.ts": `import { useCallback, useEffect } from "react";

export function useFocus(input, enabled) {
  const focus = useCallback(() => {
    if (enabled) input.current?.focus();
  }, [input, enabled]);
  useEffect(() => {
    focus();
  }, [focus]);
}
`,
  "memo.ts": `import { useMemo } from "react";

export function useValue(box) {
  return useMemo(() => box.current, [box]);
}
`,
  // These list `.current`, and are reported because of it.
  "current-is-listed.ts": `import { useCallback } from "react";

export function useValue(box) {
  return useCallback(() => box.current.value, [box.current]);
}
`,
  "callback-in-memo.ts": `import { useMemo } from "react";

export function useReader(state) {
  return useMemo(() => () => state.current, [state.current]);
}
`,
  "inner-current.ts": `import { useCallback } from "react";

export function useValue(box) {
  return useCallback(() => box.inner.current, [box.inner]);
}
`,
  "other-dependency.ts": `import { useCallback } from "react";

export function useSum(a: { x: number; y: number }, b: number) {
  const sum = useCallback(() => {
    return a.x + b;
  }, [a.y]);
  return sum;
}
`,
  // What's stored to, updated, deleted or called as a method isn't loaded: its object is the dependency.
  "current-is-written.ts": `import { useCallback, useMemo } from "react";

export function useAssign(box) {
  return useCallback(() => {
    box.current.value = 1;
  }, [box.current]);
}

export function useAssignDeep(box) {
  return useCallback(() => {
    box.current.value.inner = 1;
  }, [box.current]);
}

export function useAssignIndex(box) {
  return useCallback(() => {
    box.current[0] = 1;
  }, [box.current]);
}

export function useAssignAfterKey(box) {
  return useCallback(() => {
    box.current["value"].inner = 1;
  }, [box.current]);
}

export function useIncrement(box) {
  return useCallback(() => {
    box.current.count++;
  }, [box.current]);
}

export function useDecrementDeep(box) {
  return useCallback(() => {
    --box.current.value.count;
  }, [box.current]);
}

export function useDelete(box) {
  return useCallback(() => {
    delete box.current.value;
  }, [box.current]);
}

export function useDefault(box) {
  return useCallback(() => {
    box.current.value ??= 1;
  }, [box.current]);
}

export function useAdd(box) {
  return useCallback(() => {
    box.current.count += 1;
  }, [box.current]);
}

export function useCopy(box) {
  return useCallback(() => {
    box.current.a = box.current.b;
  }, [box.current]);
}

export function useReadThenAssign(box) {
  return useCallback(() => {
    console.log(box.current.a.b);
    box.current.a = 1;
  }, [box.current]);
}

export function useAssignInParentheses(box) {
  return useCallback(() => {
    (box.current).value = 1;
  }, [box.current]);
}

export function useAssignToParenthesized(box) {
  return useCallback(() => {
    (box).current.value = 1;
  }, [box.current]);
}

export function useAssignNonNull(box) {
  return useCallback(() => {
    box.current!.value = 1;
  }, [box.current]);
}

export function useAssignCast(box) {
  return useCallback(() => {
    (box.current.value as number) = 1;
  }, [box.current]);
}

export function useSetter(box) {
  return useMemo(
    () => () => {
      box.current.value = 1;
    },
    [box.current],
  );
}
`,
  "current-is-called.ts": `import { useCallback, useMemo } from "react";

export function useCall(box) {
  return useCallback(() => {
    box.current.focus();
  }, [box.current]);
}

export function usePush(box) {
  return useCallback(() => {
    box.current.items.push(1);
  }, [box.current]);
}

export function useCallDeep(box) {
  return useCallback(() => {
    box.current.a.b.handler.call(null);
  }, [box.current]);
}

export function useEach(box) {
  return useCallback(() => {
    box.current.items.forEach(item => item.current.run());
  }, [box.current]);
}

export function useCallAtIndex(box) {
  return useCallback(() => {
    box.current[0]();
  }, [box.current]);
}

export function useCallThenRead(box) {
  return useCallback(() => {
    return box.current.read().value;
  }, [box.current]);
}

export function useCallInParentheses(box) {
  return useCallback(() => {
    (box.current).focus();
  }, [box.current]);
}

export function useCallNonNull(box) {
  return useCallback(() => {
    box.current!.focus();
  }, [box.current]);
}

export function useCallWithTypeArguments(box) {
  return useCallback(() => {
    box.current.read<number>();
  }, [box.current]);
}

export function usePusher(box) {
  return useMemo(
    () => ({
      push() {
        box.current.items.push(1);
      },
    }),
    [box.current],
  );
}

// These read the whole chain.
export function useCallParenthesized(box) {
  return useCallback(() => {
    (box.current.focus)();
  }, [box.current]);
}

export function useCallIfDefined(box) {
  return useCallback(() => {
    box.current.focus?.();
  }, [box.current]);
}

export function useCallOfOptional(box) {
  return useCallback(() => {
    box.current?.focus();
  }, [box.current]);
}

export function useNew(box) {
  return useCallback(() => {
    new box.current.Item();
  }, [box.current]);
}

export function useTag(box) {
  return useCallback(() => {
    box.current.tag\`text\`;
  }, [box.current]);
}
`,
  "current-by-a-computed-name.ts": `import { useCallback } from "react";

export function useTemplate(box) {
  return useCallback(() => box[\`current\`].value, [box.current]);
}

export function useTemplateInside(box) {
  return useCallback(() => box.current[\`value\`].inner, [box.current]);
}

export function useAssignAfterTemplate(box) {
  return useCallback(() => {
    box.current[\`value\`].inner = 1;
  }, [box.current]);
}

export function useAssignTemplate(box) {
  return useCallback(() => {
    box.current.value[\`inner\`] = 1;
  }, [box.current]);
}

// A string that's no identifier isn't a property name.
export function useDashed(box) {
  return useCallback(() => box.current["not-a-name"].inner, [box.current]);
}

export function useReserved(box) {
  return useCallback(() => box.current["class"].inner, [box.current]);
}

export function useDigit(box) {
  return useCallback(() => box.current["0"].inner, [box.current]);
}

export function useNegative(box) {
  return useCallback(() => box.current[-1].inner, [box.current]);
}
`,
  // A variable that the callback assigns to is loaded by itself, and the assignment comes after its value.
  "assigned-in-callback.tsx": `import { useCallback, useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  const bump = useCallback(() => {
    count = count + 1;
  }, []);
  return <button onClick={bump}>{count}</button>;
}

export function useConstantRead(props) {
  const [state] = useState(props.initial);
  return useCallback(() => {
    state = 1;
    return state.current.value;
  }, [state.current]);
}

export function useAssigned(props) {
  let total = props.total;
  return useCallback(() => {
    total = 1;
  }, []);
}

export function useAssignedThenRead(props) {
  let total = props.total;
  return useCallback(() => {
    total = 1;
    console.log(total.next);
  }, [total.next]);
}

export function useAssignedItsOwnProperty(props) {
  let total = props.total;
  return useCallback(() => {
    total = total.next;
  }, [total.next]);
}

export function useReadThenAssigned(props) {
  let total = props.total;
  return useCallback(() => {
    console.log(total.next);
    total = 1;
  }, [total.next]);
}
`,
};

/** A component that's declared inside another function. */
const probe = `import { useState } from "react";
let g = 0;
export function mountProbe() {
  function Probe() {
    g = useState(1)[0];
    return null;
  }
  return Probe;
}
`;
/** `probe`, followed by `rest` at the top level. */
const gated = (rest: string) => `${probe}${rest}\n`;

/** Whether a file is compiled depends on its top-level statements. `Probe` is reported in a file that is. */
const gate: Files = {
  ".oxlintrc.json": rc(),
  "00-control-nested-only.jsx": gated(""),
  "01-control-top-fn.jsx": gated("function Top() { return null; }"),
  "02-default-anon-fn.jsx": gated("export default function () { return null; }"),
  "03-default-lower-named-fn.jsx": gated("export default function helper() { return null; }"),
  "04-default-upper-named-fn.jsx": gated("export default function Top() { return null; }"),
  "05-default-arrow.jsx": gated("export default () => null;"),
  "06-default-paren-fn-expr.jsx": gated("export default (function () { return null; });"),
  "07-default-paren-lower-named-fn-expr.jsx": gated("export default (function helper() { return null; });"),
  "08-default-memo-call.jsx": gated("export default memo(function Top() { return null; });"),
  "09-default-object.jsx": gated("export default {};"),
  "10-default-class.jsx": gated("export default class Top extends React.Component { render() { return null; } }"),
  "11-top-class.jsx": gated("class Top extends React.Component { render() { return null; } }"),
  "12-declare-fn.ts": gated("declare function Top(): void;"),
  "13-export-declare-hook.ts": gated("export declare function useTop(): void;"),
  "14-overload.ts": gated("export function Top(a: string): null;\nexport function Top(a: any) { return null; }"),
  "15-export-const-arrow.jsx": gated("export const Top = () => null;"),
  "16-const-paren-arrow.jsx": gated("const Top = (() => null);"),
  "17-const-as.ts": gated("const Top = (() => null) as any;"),
  "18-const-satisfies.ts": gated("const Top = (() => null) satisfies unknown;"),
  "19-const-typed.ts": gated("const Top: () => null = () => null;"),
  "20-const-memo.jsx": gated("const Top = memo(() => null);"),
  "21-let-assign.jsx": gated("let Top;\nTop = () => null;"),
  "22-name-use.jsx": gated("function use() { return null; }"),
  "23-name-use1.jsx": gated("function use1() { return null; }"),
  "24-name-usefoo.jsx": gated("function usefoo() { return null; }"),
  "25-name-_Top.jsx": gated("function _Top() { return null; }"),
  "26-name-dollarTop.jsx": gated("function $Top() { return null; }"),
  "27-name-nonascii-upper.jsx": gated("function Étop() { return null; }"),
  "28-async-fn.jsx": gated("async function Top() { return null; }"),
  "29-generator-fn.jsx": gated("function* Top() { return null; }"),
  "30-namespace.ts": gated("namespace NS { export function Top() { return null; } }"),
  "31-default-identifier.jsx": gated("const top = () => null;\nexport default top;"),
  "32-second-declarator.jsx": gated("const a = 1, Top = function () { return null; };"),
  "33-const-nonnull.ts": gated("const Top = (() => null)!;"),
  "34-destructure.jsx": gated("const { Top } = { Top: () => null };"),
  "35-generic-arrow.ts": gated("const Top = <T,>() => null;"),
  "36-block-fn.jsx": gated("{ function Top() { return null; } }"),
  "37-default-arrow-as.ts": gated("export default (() => null) as any;"),
  "38-export-specifier-memo.jsx": gated("const Top = memo(() => null);\nexport { Top };"),
  "39-default-async-arrow.jsx": gated("export default async () => null;"),
  "40-const-class-expr.jsx": gated("const Top = class extends React.Component { render() { return null; } };"),
  "41-object-method.jsx": gated("export const obj = { Top() { return null; } };"),
  "42-use-memo-directive.jsx": `"use memo";\n${probe}`,
  "43-default-upper-fn-expr-paren.jsx": gated("export default (function Top() { return null; });"),
  "44-export-var-hook-fnexpr.jsx": gated("export var useTop = function () { return null; };"),
  "45-const-typeassert-angle.ts": gated("const Top = <any>(() => null);"),
  "46-export-assign.ts": gated("export = function Top() { return null; };"),
  "47-const-double-paren.jsx": gated("const Top = ((() => null));"),
  "48-default-lower-async-fn.jsx": gated("export default async function helper() { return null; }"),
  "49-const-seq.jsx": gated("const Top = (0, () => null);"),
  // A path that contains `node_modules` isn't compiled, whatever the file has.
  "not_node_modules_x/50-top-fn-in-node_modules-substring.jsx": gated("function Top() { return null; }"),
};

const randomize = (hook: string) => `export function Randomize() {
  const progress = ${hook}(0);
  return <Button onPress={() => (progress.value = Math.random())} title="Randomize" />;
}
`;

/** A shared value from react-native-reanimated may be written outside of render, like a ref. */
const reanimated: Files = {
  ".oxlintrc.json": rc(),
  "imported.tsx": `import { useEffect } from "react";
import { Gesture } from "react-native-gesture-handler";
import { useDerivedValue, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

${randomize("useSharedValue")}
export function usePressToGrow() {
  const width = useSharedValue(100);
  return () => {
    width.value = withSpring(width.value + 50);
  };
}

export function useFadeIn(visible: boolean) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0);
  }, [opacity, visible]);
  return opacity;
}

export function useDrag() {
  const offset = useSharedValue({ x: 0, y: 0 });
  return Gesture.Pan()
    .onChange(event => {
      offset.value = { x: offset.value.x + event.changeX, y: offset.value.y + event.changeY };
    })
    .onFinalize(() => {
      offset.value = withSpring({ x: 0, y: 0 });
    });
}

export function Doubled() {
  const base = useSharedValue(1);
  const doubled = useDerivedValue(() => base.value * 2);
  const reset = () => {
    base.value += 1;
    doubled.value = 2;
  };
  return <Button onPress={reset} title="Reset" />;
}

export function InRender(props: { start: number }) {
  const position = useSharedValue(0);
  position.value = props.start;
  return <View data-position={position.value} />;
}
`,
  // Without the import it's an unknown hook, and what an unknown hook returns can't be modified.
  "not-imported.jsx": randomize("useSharedValue"),
  "from-another-module.jsx": `import { useSharedValue } from "./reanimated";\n\n${randomize("useSharedValue")}`,
  "other-names-imported.jsx": `import { withSpring } from "react-native-reanimated";

${randomize("useSharedValue")}
export function Spring() {
  const width = useSharedValue(0);
  return <Button onPress={() => (width.value = withSpring(1))} title="Grow" />;
}
`,
  "type-imported.tsx": `import type { SharedValue } from "react-native-reanimated";

export function Randomize() {
  const progress: SharedValue<number> = useSharedValue(0);
  return <Button onPress={() => (progress.value = Math.random())} title="Randomize" />;
}
`,
  "renamed.jsx": `import { useSharedValue as useValue } from "react-native-reanimated";\n\n${randomize("useValue")}`,
  "namespace.jsx": `import * as Reanimated from "react-native-reanimated";\n\n${randomize("Reanimated.useSharedValue")}`,
  "default.jsx": `import Animated from "react-native-reanimated";\n\n${randomize("Animated.useSharedValue")}`,
  "required.js": `const { useSharedValue } = require("react-native-reanimated");\n\n${randomize("useSharedValue")}`,
};

/** One component for each name, because only a function's first capitalized call is reported. */
const callsOf = (names: string[], call: (name: string) => string) =>
  names.map((name, k) => `export function Calls${k}(props) {\n  return <div>{${call(name)}}</div>;\n}\n`).join("\n");

const CALLED = [
  "Child",
  "GET",
  "A",
  "A1",
  "HTML5",
  "FOO_BAR",
  "$FOO",
  "_Foo",
  "_FOO",
  "Foo_BAR",
  "FOo",
  "F_o",
  "ÉCOLE",
];
const ALSO_CALLED = ["École", "Ω", "child"];

/** A name in capitals is a constant, not a component. */
const allCaps: Files = {
  ".oxlintrc.json": rc(),
  "methods.jsx": callsOf([...CALLED, ...ALSO_CALLED], name => `props.api.${name}()`),
  "functions.jsx": `import { ${[...CALLED, ...ALSO_CALLED].join(", ")} } from "./module";\n\n${callsOf([...CALLED, ...ALSO_CALLED], name => `${name}()`)}`,
  "globals.jsx": callsOf(CALLED, name => `${name}()`),
  "utc.jsx": `export function Month() {
  const now = new Date(0);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return <div>{start.toString()}</div>;
}

export function Formatted({ amount }) {
  return <div>{Intl.NumberFormat("en").format(amount)}{JSON.stringify(CSS.supports("color", "red"))}</div>;
}
`,
  "other-calls.jsx": `import { Child, GET } from "./module";

export function Optional(props) {
  return <div>{props.api?.Child()}{props.api?.GET()}</div>;
}

export function Computed(props) {
  return <div>{props.api["Child"]()}{props.api["GET"]()}</div>;
}

export function Constructed() {
  return <div>{new Child().value}{new GET().value}</div>;
}

export function Tagged() {
  return <div>{Child\`a\`}{GET\`a\`}</div>;
}

export function Local(props) {
  const Item = props.render;
  const ITEM = props.render;
  return <div>{ITEM()}{Item()}</div>;
}

export function InACallback(props) {
  const render = () => [Child(), GET()];
  return <div>{props.items.map(() => GET())}{render()}</div>;
}

export function Both(props) {
  return <div>{GET()}{Child()}</div>;
}
`,
};

/** An `.oxlintrc.json` with every rule, and options for react/capitalized-calls. */
const rcWithCalls = (options: object) =>
  JSON.stringify({
    plugins: ["react"],
    categories: { correctness: "off" },
    rules: {
      ...Object.fromEntries(RULE_NAMES.map(rule => [rule, "error"])),
      "react/capitalized-calls": ["error", options],
    },
  });

const capitalizedCalls = `import Child from "./Child";
import Other from "./Other";
import { BuildStore, ButtonClickEvent, EventChild, MakeStore, Makefile } from "./factories";
import module from "./module";

export function Named() {
  return <div>{Child()}</div>;
}

export function EndsInEvent() {
  const event = ButtonClickEvent();
  return <button onClick={() => send(event)} />;
}

export function StartsWithEvent() {
  return <div>{EventChild()}</div>;
}

export function Factory() {
  const store = MakeStore();
  return <div>{store.value}</div>;
}

export function OtherFactory() {
  const store = BuildStore();
  return <div>{store.value}</div>;
}

export function NotAFactory() {
  return <div>{Makefile()}</div>;
}

export function NotListed() {
  return <div>{Other()}</div>;
}

export function Method() {
  return <div>{module.Child()}</div>;
}

export function Local(props) {
  const Child = props.render;
  return <div>{Child()}</div>;
}

export function Global() {
  return <div>{Child2()}{ChildEvent()}</div>;
}

export function AllowedThenNot() {
  return <div>{Child()}{Other()}</div>;
}
`;

/** The names that react/capitalized-calls allows are in its options. They only apply to a name that isn't local. */
const allowedCalls: Files = {
  ".oxlintrc.json": rc([]),
  "default/.oxlintrc.json": rc(),
  "default/calls.jsx": capitalizedCalls,
  "allow/.oxlintrc.json": rcWithCalls({ allow: ["Child", "MakeStore"] }),
  "allow/calls.jsx": capitalizedCalls,
  "pattern/.oxlintrc.json": rcWithCalls({ allowPattern: "Event$" }),
  "pattern/calls.jsx": capitalizedCalls,
  "both/.oxlintrc.json": rcWithCalls({ allow: ["Child"], allowPattern: "Event$" }),
  "both/calls.jsx": capitalizedCalls,
  "unanchored/.oxlintrc.json": rcWithCalls({ allowPattern: "Child" }),
  "unanchored/calls.jsx": capitalizedCalls,
  "alternation/.oxlintrc.json": rcWithCalls({ allowPattern: "^(?:Make|Build)[A-Z]|^Other$" }),
  "alternation/calls.jsx": capitalizedCalls,
  "empty/.oxlintrc.json": rcWithCalls({ allow: [] }),
  "empty/calls.jsx": capitalizedCalls,
  "empty-pattern/.oxlintrc.json": rcWithCalls({ allowPattern: "" }),
  "empty-pattern/calls.jsx": capitalizedCalls,
  "case-insensitive/.oxlintrc.json": rcWithCalls({ allowPattern: "(?i)^child" }),
  "case-insensitive/calls.jsx": capitalizedCalls,
  "alone/.oxlintrc.json": JSON.stringify({
    plugins: ["react"],
    categories: { correctness: "off" },
    rules: { "react/capitalized-calls": ["error", { allow: ["Other"] }] },
  }),
  "alone/calls.jsx": capitalizedCalls,
};

/** An async component is a Server Component. It's rendered once, so it may call impure functions. */
const asyncComponents: Files = {
  ".oxlintrc.json": rc(),
  "declarations.jsx": `export default async function Posts() {
  const posts = await getPosts();
  return posts.map(post => <p key={post.id}>{Date.now() - post.createdAt < 86_400_000 ? "new" : ""}</p>);
}

async function Declaration() {
  const date = Date.now();
  const now = new Date();
  const random = Math.random();
  const id = crypto.randomUUID();
  return <Foo date={date} now={now} random={random} id={id} />;
}

const Arrow = async () => {
  return <p>{performance.now()}</p>;
};

const Expression = async function () {
  return <p>{new Date().getTime()}</p>;
};

export const Page = async ({ params }) => <main data-at={Date.now()}>{(await params).slug}</main>;

async function WithoutAwait() {
  return <p>{Math.random()}</p>;
}
`,
  "callbacks.jsx": `async function InAMap({ posts }) {
  return (
    <ul>
      {posts.map(post => (
        <li key={post.id}>{Date.now() - post.createdAt}</li>
      ))}
    </ul>
  );
}

async function InAHelper({ posts }) {
  const label = post => (Date.now() - post.createdAt < 86400000 ? "new" : "");
  return (
    <ul>
      {posts.map(post => (
        <li key={post.id}>{label(post)}</li>
      ))}
    </ul>
  );
}

async function InANestedComponent() {
  function Badge() {
    return <span>{Date.now()}</span>;
  }
  return <Badge />;
}

async function InAHandler() {
  const stamp = () => Math.random();
  return <button onClick={stamp} />;
}

async function InAnImmediateFunction() {
  const value = (() => Math.random())();
  return <p>{value}</p>;
}
`,
  // The other rules still apply to an async component.
  "other-rules.jsx": `import { useRef } from "react";

async function Mutates(props) {
  props.at = Date.now();
  return <p>{props.at}</p>;
}

async function ReadsARef() {
  const ref = useRef(null);
  const value = ref.current;
  return <p>{value}{Math.random()}</p>;
}
`,
  "client.jsx": `async function Server() {
  return <p>{Date.now()}</p>;
}

function AfterAServerComponent() {
  return <p>{Date.now()}</p>;
}

const Arrow = () => {
  return <p>{Math.random()}</p>;
};

function InAMap({ posts }) {
  return (
    <ul>
      {posts.map(post => (
        <li key={post.id}>{Date.now()}</li>
      ))}
    </ul>
  );
}

function CallsAnAsyncHelper() {
  const load = async () => Date.now();
  return <p>{load()}</p>;
}

function* Generator() {
  yield <p>{Math.random()}</p>;
}
`,
  "hooks.js": `import { useId } from "react";

function useNow() {
  return [useId(), Date.now()];
}

async function useAsyncNow() {
  return [useId(), new Date().getTime()];
}

const useAsyncArrow = async () => [useId(), Math.random()];

export async function useLoaded(load) {
  const id = useId();
  const at = performance.now();
  return [await load(), at, id];
}
`,
  "wrapped.jsx": `import { forwardRef, memo } from "react";

export const Memoized = memo(async function Memoized() {
  return <p>{Date.now()}</p>;
});

export const Forwarded = forwardRef(async (props, ref) => <p ref={ref}>{Math.random()}</p>);

export const Client = memo(function Client() {
  return <p>{Date.now()}</p>;
});

export function Top() {
  return null;
}
`,
};

/** `count++` on a variable that a function captures. */
const updateExpressions: Files = {
  ".oxlintrc.json": rc(),
  "in-effects.jsx": `import { useEffect, useLayoutEffect } from "react";

export function Postfix() {
  let local = 0;
  const bump = () => {
    local++;
  };
  const onMount = expected => {
    bump();
    if (local !== expected) throw new Error("not updated");
  };
  useEffect(() => {
    onMount(1);
  }, [onMount]);
  return null;
}

export function Prefix() {
  let local = 0;
  useEffect(() => {
    ++local;
  });
  return <div>{local}</div>;
}

export function Decrement() {
  let remaining = 3;
  useLayoutEffect(() => {
    const step = () => --remaining;
    step();
  }, []);
  return <div>{remaining}</div>;
}

export function InACleanup() {
  let mounted = 0;
  useEffect(() => {
    mounted++;
    return () => {
      mounted--;
    };
  }, []);
  return null;
}

export function LocalToTheEffect() {
  useEffect(() => {
    let ticks = 0;
    const id = setInterval(() => {
      ticks++;
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return null;
}
`,
  "in-handlers.jsx": `export function Inline() {
  let count = 0;
  return <button onClick={() => count++}>{count}</button>;
}

export function Named() {
  let count = 0;
  function handleClick() {
    ++count;
  }
  return <button onClick={handleClick}>{count}</button>;
}

export function Curried() {
  let count = 0;
  const by = step => () => {
    count--;
    return step;
  };
  return <button onClick={by(2)}>{count}</button>;
}

export function TheValueIsUsed() {
  let count = 0;
  const next = () => count++ + 1;
  const previous = () => --count;
  return <button onClick={next} onBlur={previous} />;
}

export function Wrapped() {
  let count = 0;
  const onClick = () => count++;
  return <button onClick={debounce(onClick)} />;
}

export function NeverPassed() {
  let count = 0;
  const unused = () => count++;
  return <button>{count}</button>;
}

export function CalledInRender() {
  let count = 0;
  const bump = () => count++;
  bump();
  return <button>{count}</button>;
}
`,
  "in-array-callbacks.jsx": `import { useDebugValue } from "react";

export function FromMap() {
  let count = 0;
  const handlers = [0].map(() => () => count++);
  return <List handlers={handlers} />;
}

export function FromFlatMap() {
  let count = 0;
  const handlers = [0].flatMap(() => [() => ++count]);
  return <List handlers={handlers} />;
}

export function useFromMap() {
  useDebugValue("map");
  let count = 0;
  return [0].map(() => () => count--);
}

export function FromForEach() {
  let count = 0;
  const value = [1].forEach(() => () => count++);
  return <div>{value}</div>;
}

export function InsideForEach({ items }) {
  let total = 0;
  items.forEach(item => {
    total++;
  });
  return <div>{total}</div>;
}

export function InsideMap({ items }) {
  let index = 0;
  return (
    <ul>
      {items.map(item => (
        <li key={index++}>{item}</li>
      ))}
    </ul>
  );
}

export function FromFilter({ items }) {
  let seen = 0;
  const kept = items.filter(() => seen++ < 2);
  return <div>{kept}</div>;
}

export function FromReduce({ items }) {
  let calls = 0;
  const handlers = items.reduce((all, item) => [...all, () => calls++], []);
  return <List handlers={handlers} />;
}

export function HandlersInAMap({ items }) {
  let clicks = 0;
  return (
    <ul>
      {items.map(item => (
        <li key={item} onClick={() => clicks++} />
      ))}
    </ul>
  );
}
`,
  "parameters.js": `import { useCallback, useDebugValue } from "react";

export function useCounter(count) {
  useDebugValue(count);
  return () => count++;
}

export function useDestructured({ count }) {
  useDebugValue(count);
  return () => --count;
}

export const useDefaulted = (cb = () => count++, { count } = { count: 0 }) => {
  useDebugValue(count);
  return cb;
};

export function useUpdatedInRender(count) {
  useDebugValue(count);
  count++;
  return count;
}

export function useCapturedAndUpdatedInRender(count) {
  useDebugValue(count);
  const read = () => count;
  ++count;
  return read;
}

export function Parameter({ count }) {
  return <button onClick={() => count++}>{count}</button>;
}

export function useCallbackParameter() {
  return useCallback(count => () => count++, []);
}

export function useOwnParameter() {
  return useCallback(count => {
    count++;
    return count;
  }, []);
}
`,
  "captures.js": `import { useDebugValue, useEffect } from "react";

export function useLiveCapture() {
  useDebugValue(null);
  let count = 0;
  let cb = () => null;
  const wrapper = () => cb();
  cb = () => count++;
  return wrapper;
}

export function useOverwrittenBeforeCapture() {
  useDebugValue(null);
  let count = 0;
  let cb = () => count++;
  cb = () => null;
  const wrapper = () => cb();
  return wrapper;
}

export function useValueBeforeReassignment() {
  useDebugValue(null);
  let count = 0;
  let cb = () => null;
  const result = cb;
  [0].map(() => cb);
  cb = () => --count;
  return result;
}

export function useLoopPhi(condition) {
  useDebugValue(null);
  let count = 0;
  let cb = () => null;
  let run = condition;
  while (run) {
    cb = () => count++;
    run = false;
  }
  return cb;
}

export function useBranch(condition) {
  useDebugValue(null);
  let count = 0;
  let cb = () => null;
  if (condition) cb = () => ++count;
  return cb;
}

export function usePostfixKillsTheOldValue() {
  useDebugValue(null);
  let count = 0;
  let cb = () => count++;
  cb++;
  return cb;
}

export function usePostfixResult() {
  useDebugValue(null);
  let count = 0;
  let cb = () => count++;
  return cb++;
}

export function useEscapesBeforeReassignment() {
  let count = 0;
  let cb = () => null;
  useEffect(() => cb(), []);
  cb = () => count++;
  return null;
}

export function useNested() {
  useDebugValue(null);
  let count = 0;
  const outer = () => {
    const inner = () => {
      count++;
    };
    return inner;
  };
  return outer;
}

export function useInAnObject() {
  useDebugValue(null);
  let count = 0;
  return { next: () => count++, previous: () => count--, get: () => count };
}

export function useObjectMethod() {
  useDebugValue(null);
  let count = 0;
  return {
    next() {
      return ++count;
    },
  };
}
`,
  "timers.js": `import { useDebugValue, useEffect } from "react";

export function useTimeoutInRender() {
  useDebugValue(null);
  let fired = 0;
  setTimeout(() => fired++, 10);
  return fired;
}

export function useInterval() {
  let ticks = 0;
  useEffect(() => {
    const id = setInterval(() => ++ticks, 1000);
    return () => clearInterval(id);
  }, []);
  return ticks;
}

export function useFrames(draw) {
  let frames = 0;
  useEffect(() => {
    let id = requestAnimationFrame(function tick() {
      frames++;
      draw(frames);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [draw]);
}

export function useMicrotask() {
  useDebugValue(null);
  let count = 0;
  queueMicrotask(() => count++);
  Promise.resolve().then(() => count--);
  return count;
}
`,
  "async.js": `import { useDebugValue, useEffect } from "react";

export function useAsyncArrow() {
  useDebugValue(null);
  let count = 0;
  const run = async () => {
    await 0;
    count++;
  };
  return run;
}

export function useBeforeAnAwait() {
  useDebugValue(null);
  let count = 0;
  const run = async () => {
    count++;
    await 0;
  };
  run();
  return null;
}

export function useCallbackParameter() {
  useDebugValue(null);
  let count = 0;
  const run = async cb => {
    await 0;
    cb();
  };
  run(() => count++);
  return null;
}

export function useUnusedParameter() {
  useDebugValue(null);
  let count = 0;
  const run = async (unused, cb) => {
    await 0;
    cb();
  };
  run(
    () => count++,
    () => null,
  );
  return null;
}

export function useThen(load) {
  useDebugValue(null);
  let count = 0;
  load().then(() => {
    ++count;
  });
  return count;
}

export function useAsyncEffect(load) {
  useEffect(() => {
    let done = 0;
    (async () => {
      await load();
      done++;
    })();
  }, [load]);
}

export function useAsyncHandler(save) {
  useDebugValue(null);
  let saving = 0;
  const onSave = async () => {
    saving++;
    try {
      await save();
    } finally {
      saving--;
    }
  };
  return onSave;
}
`,
  "typescript.ts": `import { useDebugValue } from "react";

export function useCast() {
  useDebugValue(null);
  let value = 0;
  const read = () => value;
  (value as number)++;
  return read();
}

export function useNonNull() {
  useDebugValue(null);
  let value: number | undefined = 0;
  const read = () => value;
  value!++;
  return read();
}

export function useCastInACallback() {
  useDebugValue(null);
  let value = 0;
  return () => (value as number)--;
}

export function useNonNullInACallback() {
  useDebugValue(null);
  let value: number | undefined = 0;
  return () => ++value!;
}
`,
  "members.jsx": `import { useRef, useState } from "react";

export function Ref() {
  const ref = useRef(0);
  return <button onClick={() => ref.current++} />;
}

export function RefInRender() {
  const ref = useRef(0);
  ref.current++;
  return <div />;
}

export function ObjectMember() {
  const box = { count: 0 };
  const bump = () => box.count++;
  return <button onClick={bump}>{box.count}</button>;
}

export function Props(props) {
  const bump = () => ++props.count;
  return <button onClick={bump} />;
}

export function State() {
  const [state] = useState({ count: 0 });
  return <button onClick={() => state.count--} />;
}

export function Computed({ name }) {
  const counts = {};
  const bump = () => counts[name]++;
  bump();
  return <div>{counts[name]}</div>;
}
`,
  "globals.jsx": `import { useEffect, useState } from "react";

let renders = 0;
let clicks = 0;

export function InRender() {
  renders++;
  return <div />;
}

export function InAHandler() {
  return <button onClick={() => clicks++} />;
}

export function InAnEffect() {
  useEffect(() => {
    ++renders;
  });
  return null;
}

export function useInAHook() {
  const [state] = useState(0);
  return --clicks + state;
}
`,
  "render.jsx": `export function Loop({ items }) {
  let total = 0;
  for (let i = 0; i < items.length; i++) total++;
  return <div>{total}</div>;
}

export function AfterTheCapture() {
  let a = 0;
  const read = () => a;
  a++;
  return <div onClick={read}>{a}</div>;
}

export function BeforeTheCapture() {
  let a = 0;
  a++;
  const read = () => a;
  return <div onClick={read} />;
}

export function InAnExpression(props) {
  let a = props.a;
  const read = () => a;
  const b = a++ + ++a;
  return <div onClick={read}>{b}</div>;
}

export function InALoop(props) {
  let a = 0;
  const read = () => a;
  while (a < props.limit) a++;
  return <div onClick={read}>{a}</div>;
}

export function InASequence(props) {
  let a = 0;
  const read = () => a;
  const b = (a++, a--, a);
  return <div onClick={read}>{b}</div>;
}
`,
  "default-parameter.js": `import { createRef, forwardRef } from "react";

const Component = forwardRef((cb = () => ref.current++, ref = createRef()) => <div>{cb}</div>);

export function Top() {
  return <Component />;
}
`,
};

/** A variable that's declared in a callback isn't a render variable, so a nested function may reassign it. */
const callbackLocals: Files = {
  ".oxlintrc.json": rc(),
  "effects.ts": `import { useEffect, useState } from "react";

export function useStopwatch(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      setElapsed(total => total + (now - previous));
      previous = now;
    }, 250);
    return () => clearInterval(id);
  }, [running]);
  return elapsed;
}

export function useDeferred(task: () => Promise<void>) {
  useEffect(() => {
    let handle: ReturnType<typeof setTimeout> | undefined;
    const start = async () => {
      await task();
      handle = setTimeout(() => {}, 10);
    };
    start();
    return () => clearTimeout(handle);
  }, [task]);
}

export function useSubscription(subscribe: () => Promise<() => void>) {
  useEffect(() => {
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    void subscribe().then(stop => {
      if (stopped) {
        stop();
        return;
      }
      unsubscribe = stop;
    });
    return () => {
      stopped = true;
      unsubscribe?.();
    };
  }, [subscribe]);
}

export function useRetry(attempt: () => Promise<boolean>) {
  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = async () => {
      tries += 1;
      if (!(await attempt()) && tries < 3) timer = setTimeout(again, 100 * tries);
    };
    void again();
    return () => clearTimeout(timer);
  }, [attempt]);
}

export function useCleanedUp(prop: number) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cleanedUp = false;
    setTimeout(() => {
      if (!cleanedUp) {
        cleanedUp = true;
        setCount(c => c + 1);
      }
    }, 0);
    return () => {
      if (!cleanedUp) {
        cleanedUp = true;
        setCount(c => c + 1);
      }
    };
  }, [prop]);
  return count;
}

// This one is a render variable.
export function useRenderLocal() {
  let count = 0;
  useEffect(() => {
    count = 1;
  });
  return count;
}

export function useBoth(load: () => Promise<number>) {
  let latest = 0;
  useEffect(() => {
    let cancelled = false;
    void load().then(value => {
      if (!cancelled) latest = value;
    });
    return () => {
      cancelled = true;
    };
  }, [load]);
  return latest;
}
`,
  "handlers.tsx": `export function Drag() {
  const onPointerDown = (down: PointerEvent) => {
    let last = down.clientX;
    const onMove = (move: PointerEvent) => {
      report(move.clientX - last);
      last = move.clientX;
    };
    window.addEventListener("pointermove", onMove);
  };
  return <div onPointerDown={onPointerDown} />;
}

export function Submit({ save }) {
  const onSubmit = async event => {
    let result = null;
    const finish = value => {
      result = value;
    };
    await save(event).then(finish, finish);
    return result;
  };
  return <form onSubmit={onSubmit} />;
}

export function Parameter() {
  const onChange = (value: string) => {
    const trim = () => {
      value = value.trim();
    };
    trim();
    return value;
  };
  return <input onChange={event => onChange(event.target.value)} />;
}

export function Inline({ items }) {
  return (
    <button
      onClick={() => {
        let total = 0;
        items.forEach(item => {
          total += item.size;
        });
        report(total);
      }}
    />
  );
}

// This one is a render variable.
export function RenderLocal() {
  let clicked = false;
  const onClick = () => {
    clicked = true;
  };
  return <button onClick={onClick}>{String(clicked)}</button>;
}
`,
  "callbacks.ts": `import { useCallback, useMemo } from "react";

export function useCounter() {
  return useCallback((count: number) => () => count++, []);
}

export function useAccumulator() {
  return useCallback((items: number[]) => {
    let sum = 0;
    items.forEach(item => {
      sum += item;
    });
    return sum;
  }, []);
}

export function useDebounced(fn: (...args: unknown[]) => void, ms: number) {
  return useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return (...args: unknown[]) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }, [fn, ms]);
}

export function useBox() {
  return useMemo(() => {
    let value: unknown;
    return {
      set: (next: unknown) => {
        value = next;
      },
      get: () => value,
    };
  }, []);
}

export function useOnce(fn: () => void) {
  return useCallback(() => {
    let called = false;
    return () => {
      if (called) return;
      called = true;
      fn();
    };
  }, [fn]);
}
`,
  "array-callbacks.jsx": `import { useEffect } from "react";

export function Rows({ rows }) {
  return rows.map(row => {
    let label = row.name;
    const shorten = () => {
      label = label.slice(0, 10);
    };
    if (label.length > 10) shorten();
    return <li key={row.id}>{label}</li>;
  });
}

export function Groups({ groups }) {
  const sizes = groups.flatMap(group => {
    let offset = 0;
    return group.items.map(item => () => {
      offset += item.size;
      return offset;
    });
  });
  return <List sizes={sizes} />;
}

export function Each({ items }) {
  useEffect(() => {
    items.forEach(item => {
      let seen = false;
      item.on("change", () => {
        seen = true;
      });
      item.on("close", () => report(seen));
    });
  }, [items]);
  return null;
}

export function Nested({ table }) {
  const cells = table.map(row => {
    let column = 0;
    return row.map(cell => {
      const next = () => {
        column = column + 1;
        return column;
      };
      return <td key={next()}>{cell}</td>;
    });
  });
  return <tbody>{cells}</tbody>;
}
`,
};

/** `||=`, `&&=` and `??=`. */
const logicalAssignment: Files = {
  ".oxlintrc.json": rc(),
  "locals.jsx": `export function Operators({ value }) {
  let nullish = value;
  nullish ??= "fallback";
  let and = value;
  and &&= "replaced";
  let or = value;
  or ||= "default";
  return <Stringify nullish={nullish} and={and} or={or} />;
}

export function TheResultIsUsed({ value, other }) {
  let a = value;
  const b = (a ??= other) ?? "none";
  let c;
  const d = (c ||= a &&= b);
  return <div>{a}{b}{c}{d}</div>;
}

export function InALoop({ items }) {
  let first;
  for (const item of items) {
    first ??= item;
  }
  return <div>{first}</div>;
}

export function InAValueBlock({ value, flag }) {
  let label = value;
  const result = flag ? (label ||= "default") : "none";
  return <Stringify label={label} result={result} />;
}

export function Parameters(props, ref) {
  props ??= {};
  ref ||= null;
  return <div ref={ref}>{props.a}</div>;
}

export function Destructured({ label, size = 1 }) {
  label ??= "none";
  size &&= size * 2;
  return <div style={{ size }}>{label}</div>;
}
`,
  "members.jsx": `export function Targets({ value }) {
  const obj = { x: value, a: 0, full: 1 };
  const calls = { key: 0, rhs: 0 };
  function key() {
    calls.key += 1;
    return "a";
  }
  function rhs(result) {
    calls.rhs += 1;
    return result;
  }
  obj.x ??= rhs("fallback");
  obj[key()] ||= rhs("updated");
  const skipped = (obj.full ??= rhs("skipped"));
  return <Stringify obj={obj} calls={calls} skipped={skipped} />;
}

export function Props(props) {
  props.label ??= "none";
  return <div>{props.label}</div>;
}

export function NestedProps(props) {
  props.style.color ||= "red";
  return <div style={props.style} />;
}

export function State() {
  const [state] = useState({});
  state.count &&= 0;
  return <div>{state.count}</div>;
}

export function AfterItsFrozen({ value }) {
  const obj = { value };
  const element = <Child obj={obj} />;
  obj.value ??= 1;
  return element;
}

export function InAHandler(props) {
  const onClick = () => {
    props.cache.value ??= compute();
  };
  return <button onClick={onClick} />;
}

export function Optional({ value }) {
  const obj = { inner: value };
  obj.inner.count ??= 0;
  obj["inner"].total ||= obj.inner.count;
  return <div>{obj.inner.total}</div>;
}
`,
  "refs.jsx": `import { useEffect, useRef } from "react";

export function LazilyInitialized(props) {
  const ref = useRef(null);
  ref.current ??= props.value;
  return <Child ref={ref} />;
}

export function Or(props) {
  const ref = useRef(null);
  ref.current ||= props.value;
  return ref;
}

export function And(props) {
  const ref = useRef(null);
  ref.current &&= props.value;
  return <Child ref={ref} />;
}

export function ReadAfterwards() {
  const ownerRef = useRef(null);
  ownerRef.current ??= Symbol("owner");
  const owner = ownerRef.current;
  useEffect(() => () => release(owner), [owner]);
  return null;
}

export function Member(props) {
  const ref = useRef({});
  ref.current.value ??= props.value;
  return <Child ref={ref} />;
}

export function InAnEffect(props) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current ||= props.value;
    ref.current &&= props.other;
  });
  return <Child ref={ref} />;
}

export function TheResultIsUsed(props) {
  const ref = useRef(null);
  const value = (ref.current ??= props.value);
  return <div>{value}</div>;
}

export function Twice(props) {
  const ref = useRef(null);
  ref.current ??= props.a;
  ref.current ??= props.b;
  return <Child ref={ref} />;
}
`,
  "const.jsx": `const moduleValue = 1;

export function NeverAssigns() {
  const value = 1;
  value ??= 2;
  return <div>{value}</div>;
}

export function Nullish() {
  const value = null;
  value ??= 2;
  return <div>{value}</div>;
}

export function Or() {
  const value = false;
  value ||= true;
  return <div>{value}</div>;
}

export function And() {
  const value = true;
  value &&= false;
  return <div>{value}</div>;
}

export function ClosedOver() {
  const value = 1;
  const assign = () => {
    value &&= 2;
    return value;
  };
  return <div>{assign()}</div>;
}

export function Captured() {
  const value = 1;
  const read = () => value;
  value ??= 2;
  return <div>{read()}</div>;
}

export function Module() {
  moduleValue ??= 2;
  return <div>{moduleValue}</div>;
}

export function Props(props) {
  const { label } = props;
  label ||= "none";
  return <div>{label}</div>;
}
`,
  "context.jsx": `import { useEffect } from "react";

export function Captured({ value }) {
  let cached = value;
  const read = () => cached;
  cached ??= "fallback";
  return <Stringify cached={read()} />;
}

export function InACallback({ value }) {
  let cached = value;
  const fill = () => {
    cached ??= compute();
    return cached;
  };
  return <Stringify cached={fill()} />;
}

export function InAHandler({ value }) {
  let cached = value;
  const onClick = () => {
    cached ||= compute();
  };
  return <button onClick={onClick}>{cached}</button>;
}

export function InAnEffect({ value }) {
  let cached = value;
  useEffect(() => {
    cached &&= null;
  });
  return <div>{cached}</div>;
}

export function LocalToTheCallback({ load }) {
  useEffect(() => {
    let pending;
    const start = () => {
      pending ??= load();
      return pending;
    };
    start();
  }, [load]);
  return null;
}

export function CapturedReceiver({ value }) {
  let obj = {};
  const other = { x: "other" };
  Object.defineProperty(obj, "x", {
    get() {
      obj = other;
      return null;
    },
    configurable: true,
  });
  const fromGetter = (obj.x ??= value);
  return <Stringify fromGetter={fromGetter} same={obj === other} />;
}

export function CapturedKey({ value }) {
  let key = "a";
  const keyed = {};
  Object.defineProperty(keyed, "a", {
    get() {
      key = "b";
      return null;
    },
    configurable: true,
  });
  const fromKey = (keyed[key] ||= value);
  return <Stringify fromKey={fromKey} name={key} />;
}
`,
  "globals.jsx": `let cache;
let count = 0;

export function InRender(props) {
  cache ??= props.value;
  return <div>{cache}</div>;
}

export function InAHandler(props) {
  const onClick = () => {
    cache ||= props.value;
    count &&= 0;
  };
  return <button onClick={onClick} />;
}

export function Undeclared(props) {
  window.started ??= Date.now();
  globalCache ??= props.value;
  return <div />;
}
`,
};

/** `new Date()` without arguments is only reported in the body of a component or a hook. */
const newDate: Files = {
  ".oxlintrc.json": rc(),
  "render.jsx": `import { useMemo, useState } from "react";

export function InRender() {
  const now = new Date();
  return <div>{now.getTime()}</div>;
}

export function WithoutParentheses() {
  const now = new Date;
  return <div>{now.getTime()}</div>;
}

export function Chained() {
  const time = new Date().getTime();
  const year = new Date().getFullYear();
  return <Foo time={time} year={year} />;
}

export function WithArguments({ timestamp }) {
  const epoch = new Date(0);
  const date = new Date(timestamp);
  const parts = new Date(2020, 0, 1);
  const spread = new Date(...timestamp.parts);
  return <Foo epoch={epoch} date={date} parts={parts} spread={spread} />;
}

export function FromNow() {
  const date = new Date(Date.now());
  return <Foo date={date} />;
}

export function InJsx() {
  return <time dateTime={new Date().toISOString()} />;
}

export function InAMemo() {
  const today = useMemo(() => new Date(), []);
  return <Foo today={today} />;
}

export function InitialState() {
  const [eager] = useState(new Date());
  const [lazy] = useState(() => new Date());
  return <Foo eager={eager} lazy={lazy} />;
}

export function useToday() {
  const [offset] = useState(0);
  return [new Date(), offset];
}

export function Shadowed({ Date }) {
  return <Foo date={new Date()} />;
}
`,
  "through-an-object.jsx": `export function Window() {
  const now = new window.Date();
  return <Foo now={now} />;
}

export function GlobalThis() {
  const now = new globalThis.Date();
  return <Foo now={now} />;
}
`,
  "callbacks.jsx": `import { useCallback, useEffect } from "react";

export function Submit({ form, create }) {
  const onSubmit = async data => {
    await create({ ...data, createdAt: new Date(), updatedAt: new Date() });
  };
  return <form onSubmit={form.handleSubmit(onSubmit)} />;
}

export function Wrapped({ create }) {
  const onClick = () => create(new Date());
  return <button onClick={debounce(onClick)} />;
}

export function DateNowWrapped({ create }) {
  const onClick = () => create(Date.now());
  return <button onClick={debounce(onClick)} />;
}

export function Inline({ create }) {
  return <button onClick={() => create(new Date())} />;
}

export function InAnEffect({ report }) {
  useEffect(() => {
    report(new Date());
  }, [report]);
  return null;
}

export function Memoized({ report }) {
  const onClick = useCallback(() => report(new Date()), [report]);
  return <button onClick={onClick} />;
}

export function InAMap({ items }) {
  return (
    <ul>
      {items.map(item => (
        <li key={item.id}>{new Date().getTime() - item.at}</li>
      ))}
    </ul>
  );
}

export function CalledInRender() {
  const today = () => new Date();
  return <Foo today={today()} />;
}

export function Immediate() {
  const today = (() => new Date())();
  return <Foo today={today} />;
}

export function InAHelper({ items }) {
  function age(item) {
    return new Date() - item.at;
  }
  return <Foo ages={items.map(age)} />;
}

export function Nested({ create }) {
  const make = () => () => create(new Date());
  return <button onClick={make()} />;
}

export function useStamp(report) {
  return useCallback(() => report(new Date()), [report]);
}

export function useStampNotMemoized() {
  useEffect(() => {});
  return () => new Date();
}
`,
};

/** A function declaration is initialized when its scope is entered, so a callback above it may capture it. */
const hoistedFunctions: Files = {
  ".oxlintrc.json": rc(),
  "captured-before-declaration.jsx": `import { useCallback, useEffect } from "react";

export function HookArgument({ value }) {
  const callback = useIdentity(() => format());
  function format() {
    return \`value: \${value}\`;
  }
  return <Stringify callback={callback} format={format} />;
}

export function Handler({ value }) {
  const onClick = () => send(read());
  function read() {
    return value;
  }
  return <button onClick={onClick} />;
}

export function Effect({ value }) {
  useEffect(() => {
    log();
  });
  function log() {
    console.log(value);
  }
  return null;
}

export function Memoized({ value }) {
  const onClick = useCallback(() => send(read()), [read]);
  function read() {
    return value;
  }
  return <button onClick={onClick} />;
}

export function PassedByName({ value }) {
  const element = <button onClick={handle} />;
  function handle() {
    send(value);
  }
  return element;
}

export function CalledBeforeDeclaration({ value }) {
  const result = compute();
  function compute() {
    return { value };
  }
  return <Stringify result={result} compute={compute} />;
}

export function Recursive({ depth }) {
  const start = () => walk(depth);
  function walk(n) {
    return n > 0 ? walk(n - 1) : 0;
  }
  return <button onClick={start} />;
}

export function EachOther({ value }) {
  const start = () => first();
  function first() {
    return second();
  }
  function second() {
    return value;
  }
  return <button onClick={start} />;
}
`,
  "reassigned.jsx": `export function AfterTheCapture() {
  const callback = useIdentity(() => format());
  format = () => "reassigned";
  function format() {
    return "declared";
  }
  return callback;
}

export function BeforeTheDeclaration() {
  let count = 0;
  wrapper = () => null;
  function wrapper() {
    count++;
  }
  return <button onClick={() => wrapper()} />;
}

export function AfterTheDeclaration({ value }) {
  const onClick = () => send(read());
  function read() {
    return value;
  }
  read = () => null;
  return <button onClick={onClick} />;
}

export function InAHandler({ value }) {
  function read() {
    return value;
  }
  const onClick = () => {
    read = () => null;
  };
  return <button onClick={onClick}>{read()}</button>;
}
`,
  "reassigns-a-local.jsx": `import { useDebugValue } from "react";

export function useCapturedBeforeDeclaration() {
  useDebugValue(null);
  let count = 0;
  const cb = () => wrapper();
  function wrapper() {
    count++;
  }
  return cb;
}

export function useReferencedBeforeDeclaration() {
  useDebugValue(null);
  let count = 0;
  const result = wrapper;
  function wrapper() {
    count++;
  }
  return result;
}

export function useDeclaredFirst() {
  useDebugValue(null);
  let count = 0;
  function wrapper() {
    count = count + 1;
  }
  const cb = () => wrapper();
  return cb;
}

export function CapturedBeforeDeclaration() {
  let count = 0;
  const cb = () => wrapper();
  function wrapper() {
    count++;
  }
  return <button onClick={cb}>{count}</button>;
}
`,
  "in-blocks.jsx": `export function InABlock({ value, flag }) {
  let onClick = null;
  if (flag) {
    onClick = () => send(read());
    function read() {
      return value;
    }
  }
  return <button onClick={onClick} />;
}

export function InACallback({ value }) {
  const onClick = () => {
    const later = () => read();
    function read() {
      return value;
    }
    return later();
  };
  return <button onClick={onClick} />;
}

export function AfterAReturn({ value }) {
  const onClick = () => send(read());
  return <button onClick={onClick} />;

  function read() {
    return value;
  }
}
`,
};

/** Passing `props.inputRef` as a `ref` doesn't make `props` a ref. */
const refReceiver: Files = {
  ".oxlintrc.json": rc(),
  "members.tsx": `export function Sibling(props) {
  return <input ref={props.inputRef} value={props.value} readOnly />;
}

export function OwnRef(props) {
  return <button ref={props.ref} />;
}

export function Destructured({ ref }) {
  return <button ref={ref} />;
}

export function Nested(props) {
  return <input ref={props.refs.input} value={props.refs.value} aria-label={props.label} />;
}

export function Computed(props) {
  return <input ref={props.refs[props.index]} value={props.values[props.index]} readOnly />;
}

export function Optional(props) {
  return <input ref={props.refs?.input} value={props.refs?.value} readOnly />;
}

export function Conditional(props) {
  return <input ref={props.flag ? props.first : props.second} value={props.first.value} readOnly />;
}

export function OnAComponent(props) {
  return <Field ref={props.fieldRef} innerRef={props.inner} label={props.label} />;
}
`,
  "callback-refs.tsx": `const callbacks = {
  refs: { setReference() {}, setFloating() {} },
  floatingStyles: { position: "absolute" },
};

function useFloating() {
  return callbacks;
}

export function Floating() {
  const { refs, floatingStyles } = useFloating();
  return (
    <>
      <div ref={refs.setReference} />
      <div ref={refs.setFloating} style={floatingStyles} />
    </>
  );
}

export function NotDestructured() {
  const floating = useFloating();
  return <div ref={floating.refs.setFloating} style={floating.floatingStyles} />;
}

export function State() {
  const [state] = useState({ attach() {}, label: "a" });
  return <div ref={state.attach}>{state.label}</div>;
}

export function Context() {
  const context = useContext(Fields);
  return <input ref={context.register} name={context.name} />;
}
`,
  // These read a ref's value during render.
  "reads.tsx": `import { useRef } from "react";

export function CurrentOfAProp(props) {
  return <input ref={props.inputRef} value={props.inputRef.current} readOnly />;
}

export function OwnRefAndItsValue() {
  const ref = useRef(null);
  return <input ref={ref} value={ref.current} readOnly />;
}

export function RefInAnObject() {
  const ref = useRef(null);
  const fields = { input: ref, label: "a" };
  return <input ref={fields.input} aria-label={fields.label} value={fields.input.current} readOnly />;
}

export function AfterwardsInRender(props) {
  const element = <input ref={props.inputRef} />;
  props.inputRef.current = null;
  return element;
}
`,
};

/** A value that's assigned in a `try` block and used after it, and a ref that's compared with what a function returns. */
const catchPhis: Files = {
  ".oxlintrc.json": rc(),
  "phis.jsx": `import { useMemo } from "react";

export function ConstantDeclaration() {
  let x = 0;
  try {
    const p = "p";
    x = f(p);
  } catch {}
  return <div>{x}</div>;
}

export function useNestedConditional(json) {
  return useMemo(() => {
    let result = 0;
    try {
      result = json ? f(json) : null;
    } catch {}
    return result;
  }, [json]);
}

export function PrunedEdgeValues({ value }) {
  let result = "initial";
  try {
    const prefix = "p";
    result = read(prefix, value);
  } catch {
    result = "caught";
  }
  return <div>{result}</div>;
}

export function TwoVariables({ value }) {
  let a = null;
  let b = null;
  try {
    const key = 1;
    a = first(key);
    const other = key + 1;
    b = second(other, value);
  } catch {
    b = a;
  }
  return <div>{a}{b}</div>;
}

export function Logical({ value }) {
  let result = null;
  try {
    const fallback = "none";
    result = (value && parse(value)) ?? fallback;
  } catch {}
  return <div>{result}</div>;
}

export function InALoop({ items }) {
  let last = null;
  for (const item of items) {
    try {
      const scale = 2;
      last = item.read(scale);
    } catch {
      continue;
    }
  }
  return <div>{last}</div>;
}

export function Nested({ value }) {
  let result = 0;
  try {
    const one = 1;
    try {
      const two = 2;
      result = f(one, two, value);
    } catch {}
    result = g(result, one);
  } catch {}
  return <div>{result}</div>;
}

export function WithAParameter({ value }) {
  let result = null;
  try {
    const limit = 10;
    result = f(value, limit);
  } catch (error) {
    result = String(error);
  }
  return <div>{result}</div>;
}
`,
  "callbacks.jsx": `import { useRef } from "react";

export function NullishGuard() {
  const ref = useRef(null);
  const empty = () => null;
  if (ref.current === empty()) {
    ref.current = 1;
  }
  return <div />;
}

export function CallbackResult() {
  const ref = useRef(null);
  const callbacks = { read: () => ({ ref }) };
  const { ref: alias } = callbacks.read();
  return <div>{alias.current}</div>;
}

export function UndefinedGuard() {
  const ref = useRef();
  const nothing = () => undefined;
  if (ref.current === nothing()) {
    ref.current = create();
  }
  return <div />;
}

export function LooseGuard() {
  const ref = useRef(null);
  const empty = () => null;
  if (ref.current == empty()) {
    ref.current = create();
  }
  return <div />;
}

export function NotAGuard() {
  const ref = useRef(null);
  const zero = () => 0;
  if (ref.current === zero()) {
    ref.current = 1;
  }
  return <div />;
}

export function ReturnsTheRef() {
  const ref = useRef(null);
  const get = () => ref;
  const same = get();
  return <div>{same.current}</div>;
}

export function Declaration() {
  const ref = useRef(null);
  function empty() {
    return null;
  }
  if (ref.current === empty()) {
    ref.current = 1;
  }
  return <div ref={ref} />;
}
`,
  "catch-parameter.js": `import { useState } from "react";
const bar = () => ({ data: null });

export const useFoot = () => {
  const [, setState] = useState(null);
  try {
    const { data } = bar();
    setState({
      data,
      error: null,
    });
  } catch (err) {
    setState(_prevState => ({
      loading: false,
      error: err,
    }));
  }
};

export function useCaptured(load) {
  const [, setError] = useState(null);
  try {
    load();
  } catch (thrown) {
    const report = () => setError(thrown);
    report();
  }
}
`,
};

/**
 * A comment that disables an ESLint rule of React. The compiler used to skip every function that such a comment is
 * in, and react/rule-suppression reported the comment.
 */
const suppressions: Files = {
  ".oxlintrc.json": rc(),
  "next-line.jsx": `import { useRef } from "react";

export function NothingElse({ value }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doubled = value * 2;
  return <div>{doubled}</div>;
}

export function RulesOfHooks({ value }) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const doubled = value * 2;
  return <div>{doubled}{Date.now()}</div>;
}

export function AboveTheReport() {
  const ref = useRef(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  ref.current = "bad";
  return <button ref={ref} />;
}

export function Unrelated({ value }) {
  // eslint-disable-next-line no-console
  console.log(value);
  return <div>{Math.random()}</div>;
}

export function SeveralRules(props) {
  // eslint-disable-next-line react-hooks/rules-of-hooks, react-hooks/exhaustive-deps, no-console
  props.value = 1;
  return <div />;
}

export function Oxlint() {
  // oxlint-disable-next-line react/exhaustive-deps
  const filler = 0;
  const b = Math.random() + filler;
  return <div>{b}</div>;
}

export function OxlintRulesOfHooks(props) {
  // oxlint-disable-next-line react-hooks/rules-of-hooks
  if (props.flag) useThing();
  return <div />;
}

export function Untouched() {
  return <div>{Date.now()}</div>;
}
`,
  "block.jsx": `import { useEffect, useState } from "react";

/* eslint-disable react-hooks/rules-of-hooks */
export function Inside({ value }) {
  const doubled = value * 2;
  return <div>{doubled}{Date.now()}</div>;
}
/* eslint-enable react-hooks/rules-of-hooks */

export function After() {
  return <div>{Date.now()}</div>;
}

/* eslint-disable react-hooks/exhaustive-deps */
export function Form({ item }) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (!item) return;
    setName(item.name);
  }, [item?.id]);
  return <input value={name} onChange={event => setName(event.target.value)} />;
}
/* eslint-enable */

export function Last(props) {
  props.value = 1;
  return <div />;
}
`,
  "unclosed.jsx": `/* eslint-disable react-hooks/rules-of-hooks */
function lowercasecomponent() {
  "use forget";
  const x = [];
  return <div>{x}</div>;
}

export function First(props) {
  return <div>{props.greeting}</div>;
}

export function Second() {
  let x = React.useMemo(async () => {
    await a;
  }, []);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return <div>{x}{Math.random()}</div>;
}
`,
  "unclosed-exhaustive-deps.jsx": `/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useMemo } from "react";

export function Effect({ x }) {
  useEffect(() => {
    console.log(x);
  }, []);
  return null;
}

export function Memo({ x }) {
  const value = useMemo(() => [x], []);
  return <div>{value}</div>;
}

export function Callback({ x }) {
  const send = useCallback(() => post(x), []);
  return <button onClick={send} />;
}
`,
  "use-no-forget.jsx": `import { useRef } from "react";

const useControllableState = options => {};
function NoopComponent() {}

export function OptedOut() {
  "use no forget";
  const ref = useRef(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  ref.current = "bad";
  return <button ref={ref} />;
}

export function OptedOutWithNoMemo(props) {
  "use no memo";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  props.value = 1;
  return <div>{Date.now()}</div>;
}

/* eslint-disable react-hooks/rules-of-hooks */
function optedin() {
  "use forget";
  const x = [];
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return <div>{x}{Date.now()}</div>;
}
/* eslint-enable react-hooks/rules-of-hooks */
`,
  "dependencies.jsx": `import { useCallback, useEffect, useMemo, useState } from "react";

export function Effect({ x }) {
  useEffect(
    () => {
      console.log(x);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [
      /* intentionally missing */
    ],
  );
  const memo = useMemo(() => [x], [x]);
  return <Validate inputs={[x]} output={memo} />;
}

export function Callback() {
  const item = [];
  const push = useCallback(
    () => {
      arrayPush(item, 1);
    }, // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return <Button push={push} />;
}

export function Form({ item }) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (!item) return;
    setName(item.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);
  return <input value={name} onChange={event => setName(event.target.value)} />;
}

export function SameLine({ a, b }) {
  const sum = useMemo(() => a + b, [a]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div>{sum}</div>;
}
`,
  "every-rule.jsx": `/* eslint-disable */
export function Component(props) {
  props.value = Date.now();
  return <div />;
}
`,
  "flow.jsx": `export function Hook({ value }) {
  // $FlowFixMe[react-rule-hook]
  const doubled = value * 2;
  return <div>{doubled}{Date.now()}</div>;
}

export function Ref({ value }) {
  // $FlowFixMe[react-rule-unsafe-ref]
  const doubled = value * 2;
  return <div>{doubled}{Date.now()}</div>;
}

export function Other() {
  // $FlowFixMe[incompatible-type]
  return <div>{Date.now()}</div>;
}
`,
};

/** `declare` in a function declares nothing at run time. */
const ambientDeclarations: Files = {
  ".oxlintrc.json": rc(),
  "inside.tsx": `import { useRef } from "react";

export function Var() {
  declare var document: Document | undefined;
  const env = typeof document === "undefined" ? "server" : document.nodeName;
  return <div>{env}</div>;
}

export function Const() {
  declare const __DEV__: boolean;
  return <div>{__DEV__ ? "dev" : "prod"}</div>;
}

export function Let() {
  declare let navigator: Navigator | undefined;
  return <div>{navigator?.language}</div>;
}

export function ReferencedBeforeTheDeclaration() {
  const env = typeof document === "undefined" ? "server" : document.nodeName;
  declare const document: Document | undefined;
  return <div>{env}</div>;
}

export function InACallback() {
  declare const document: Document | undefined;
  const readEnv = () => (typeof document === "undefined" ? "server" : document.nodeName);
  return <button onClick={readEnv}>{readEnv()}</button>;
}

export function BesideAnUninitializedLocal({ flag }) {
  let value;
  declare const document: Document | undefined;
  if (flag) value = typeof document === "undefined" ? "server" : document.nodeName;
  return <div>{value}</div>;
}

export function SeveralNames() {
  declare const first: number, second: number;
  return <div>{first + second}</div>;
}

export function InABlock({ flag }) {
  if (flag) {
    declare const analytics: { track(name: string): void };
    analytics.track("shown");
  }
  return <div />;
}

export function DeclaredInACallback() {
  const onClick = () => {
    declare const analytics: { track(name: string): void };
    analytics.track("click");
  };
  return <button onClick={onClick} />;
}

export function Written() {
  declare let title: string;
  title = "changed";
  return <div>{title}</div>;
}

export function WithAReport() {
  declare const scale: number;
  const ref = useRef(0);
  return <div>{ref.current * scale}</div>;
}
`,
  "before.tsx": `import { useRef } from "react";

declare const __DEV__: boolean;
declare var analytics: { track(name: string): void; last?: string };
declare let counter: number;
declare function track(name: string): void;
declare class Store {
  read(): number;
}
declare namespace Flags {
  const enabled: boolean;
}
declare enum Mode {
  Light,
  Dark,
}
declare global {
  interface Window {
    started?: number;
  }
}
declare module "virtual:config" {
  export const name: string;
}

export function Reads() {
  return <div>{__DEV__ ? "dev" : Flags.enabled ? "on" : "off"}{Mode.Dark}</div>;
}

export function Calls() {
  track("render");
  analytics.track("render");
  return <div>{new Store().read()}</div>;
}

export function Writes() {
  counter = counter + 1;
  analytics.last = "render";
  return <div>{counter}</div>;
}

export function InAHandler() {
  const onClick = () => {
    counter++;
    track("click");
  };
  return <button onClick={onClick} />;
}

export function WithAReport() {
  const ref = useRef(0);
  return <div>{__DEV__ ? ref.current : 0}</div>;
}
`,
};

/** A `finally` block isn't compiled, but the rules see what it and its `try` block use. */
const tryFinally: Files = {
  ".oxlintrc.json": rc(),
  "dependencies.jsx": `import { useCallback, useEffect, useMemo, useState } from "react";

export function TryBody() {
  const [foo] = useState("bar");
  useEffect(() => {
    try {
      report(foo);
    } finally {
    }
  }, [foo]);
}

export function FinallyBody() {
  const [foo] = useState("bar");
  const cb = useCallback(() => {
    try {
      report("x");
    } finally {
      report(foo);
    }
  }, [foo]);
  return <button onClick={cb} />;
}

export function WithACatch() {
  const [foo] = useState("bar");
  const cb = useCallback(() => {
    try {
      report("x");
    } catch {
      report("y");
    } finally {
      report(foo);
    }
  }, [foo]);
  return <button onClick={cb} />;
}

export function ReturnInTry({ foo }) {
  const value = useMemo(() => {
    try {
      return foo;
    } finally {
      report("z");
    }
  }, [foo]);
  return <div>{value}</div>;
}

export function MissingInFinally() {
  const [foo] = useState("bar");
  useEffect(() => {
    try {
      report("x");
    } finally {
      report(foo);
    }
  }, []);
}

export function MissingInTry({ a, b }) {
  const value = useMemo(() => {
    try {
      return compute(a);
    } finally {
      report(b);
    }
  }, [b]);
  return <div>{value}</div>;
}

export function ExtraInFinally({ a, b }) {
  const cb = useCallback(() => {
    try {
      report(a);
    } finally {
      report("done");
    }
  }, [a, b]);
  return <button onClick={cb} />;
}

export function Nested({ a, b, c }) {
  const cb = useCallback(() => {
    try {
      try {
        report(a);
      } finally {
        report(b);
      }
    } finally {
      report(c);
    }
  }, [a]);
  return <button onClick={cb} />;
}
`,
  "render.jsx": `import { useRef, useState } from "react";

export function Plain(props) {
  let value = 0;
  try {
    value = props.load();
  } finally {
    props.done();
  }
  return <div>{value}</div>;
}

export function ReadsARefInTry() {
  const ref = useRef(null);
  let value;
  try {
    value = ref.current;
  } finally {
    cleanup();
  }
  return <div>{value}</div>;
}

export function ReadsARefInFinally() {
  const ref = useRef(null);
  let value;
  try {
    prepare();
  } finally {
    value = ref.current;
  }
  return <div>{value}</div>;
}

export function MutatesInFinally(props) {
  try {
    prepare();
  } finally {
    props.done = true;
  }
  return <div />;
}

export function SetsStateInFinally() {
  const [state, setState] = useState(0);
  try {
    prepare();
  } finally {
    setState(1);
  }
  return <div>{state}</div>;
}

export function ImpureInFinally() {
  let at;
  try {
    prepare();
  } finally {
    at = Date.now();
  }
  return <div>{at}</div>;
}

export function HookInTry() {
  try {
    const [state] = useState(0);
    return <div>{state}</div>;
  } finally {
    cleanup();
  }
}

export function JsxInTry(props) {
  try {
    return <Child value={props.value} />;
  } finally {
    cleanup();
  }
}

export function WithACatch(props) {
  let value = 0;
  try {
    value = props.load();
  } catch (error) {
    value = -1;
  } finally {
    props.done();
  }
  return <div>{value}</div>;
}

export function AfterTheStatement(props) {
  try {
    prepare();
  } finally {
    cleanup();
  }
  props.value = 1;
  return <div />;
}

export function InALoop({ items }) {
  const ref = useRef(null);
  for (const item of items) {
    try {
      if (item.skip) continue;
      item.run();
    } finally {
      item.close();
    }
  }
  return <div>{ref.current}</div>;
}

export function InAHandler(props) {
  const ref = useRef(null);
  const onClick = () => {
    try {
      ref.current = props.load();
    } finally {
      props.done();
    }
  };
  return <button onClick={onClick} />;
}
`,
};

const cannotThrow = (body: string, handler: string) => `  try {\n    ${body}\n  } catch {\n    ${handler}\n  }`;

/** A `try` block with nothing in it that can throw. Its `catch` block is removed. */
const unreachableCatch: Files = {
  ".oxlintrc.json": rc(),
  "unreachable.jsx": `import { useMemo, useRef } from "react";

export function ReassignsAnOuterVariable() {
  let x = 0;
${cannotThrow("const unused = 1;", "x = 2;")}
  return <div>{x}</div>;
}

export function InALoop(props) {
  let x = 0;
  for (let i = 0; i < props.count; i++) {
    try {
      const unused = 1;
    } catch {
      x = i;
    }
  }
  return <div>{x}</div>;
}

export function Nested(props) {
  let x = props.value;
  try {
    try {
      const unused = 1;
    } catch {
      x = 1;
    }
  } catch {
    x = 2;
  }
  return <div>{x}</div>;
}

export function WithAnIf(props) {
  let x = props.value;
  try {
    const unused = 1;
  } catch {
    if (props.cond) {
      x = 1;
    } else {
      x = 2;
    }
  }
  return <div>{x}</div>;
}

export function WithoutAReassignment(props) {
  try {
    const unused = 1;
  } catch {
    if (props.cond) {
      props.onError();
    } else {
      props.onFallback();
    }
  }
  return <div>{props.value}</div>;
}

export function Empty() {
  let x = 0;
  try {
  } catch {
    x = 1;
  }
  return <div>{x}</div>;
}

export function WithAParameter() {
  let message = "";
  try {
    const unused = "a";
  } catch (error) {
    message = String(error);
  }
  return <div>{message}</div>;
}

export function Arithmetic() {
  let x = 0;
  try {
    const a = 1;
    const b = a + 2;
    x = b;
  } catch {
    x = -1;
  }
  return <div>{x}</div>;
}

export function InAWhileLoop(props) {
  let x = 0;
  let i = 0;
  while (i < props.count) {
    try {
      const step = 1;
      i = i + step;
    } catch {
      x = i;
      break;
    }
  }
  return <div>{x}</div>;
}

export function InAMemo({ value }) {
  const result = useMemo(() => {
    let x = value;
    try {
      const unused = 1;
    } catch {
      x = null;
    }
    return x;
  }, [value]);
  return <div>{result}</div>;
}

export function InAHandler({ send }) {
  const onClick = () => {
    let x = 0;
    try {
      const unused = 1;
    } catch {
      x = 2;
    }
    send(x);
  };
  return <button onClick={onClick} />;
}

export function ReturnsFromTheCatch() {
  try {
    const unused = 1;
  } catch {
    return null;
  }
  return <div />;
}

export function TwoInARow() {
  let x = 0;
  let y = 0;
${cannotThrow("const first = 1;", "x = 1;")}
${cannotThrow("const second = 2;", "y = x;")}
  return <div>{x}{y}</div>;
}
`,
  // The rest of the function is still checked.
  "with-a-report.jsx": `import { useRef } from "react";

export function AfterTheTry() {
  const ref = useRef(null);
  let x = 0;
${cannotThrow("const unused = 1;", "x = 2;")}
  return <div>{x}{ref.current}</div>;
}

export function InTheCatch(props) {
  let x = 0;
${cannotThrow("const unused = 1;", "props.value = x;")}
  return <div>{x}</div>;
}

export function InALoop(props) {
  const ref = useRef(null);
  let x = 0;
  for (let i = 0; i < props.count; i++) {
    try {
      const unused = 1;
    } catch {
      x = ref.current;
    }
  }
  props.last = x;
  return <div>{x}</div>;
}

export function Reachable(props) {
  const ref = useRef(null);
  let x = 0;
  try {
    props.load();
  } catch {
    x = ref.current;
  }
  return <div>{x}</div>;
}
`,
  // A parameter that a function in the `catch` block refers to and something assigns to. From `OnlyRead` on, that
  // isn't so, or the block is reached when the function is lowered.
  "written-parameter.jsx": `import { useEffect, useRef } from "react";

export function Assigns() {
  const ref = useRef(null);
  let x = 0;
  try {
  } catch (error) {
    const reset = () => {
      error = null;
    };
    x = reset;
  }
  return <div>{ref.current}{x}</div>;
}

export function AssignsAndIsUnused() {
  try {
  } catch (error) {
    const reset = () => {
      error = null;
    };
  }
  return <div />;
}

export function Updates() {
  let x = 0;
  try {
  } catch (count) {
    const next = () => {
      count++;
    };
    x = next;
  }
  return <div>{x}</div>;
}

export function InAnEffect() {
  try {
  } catch (error) {
    useEffect(() => {
      error = null;
    });
  }
  return <div />;
}

export function InAFunctionDeclaration() {
  let x = 0;
  try {
  } catch (error) {
    function reset() {
      error = null;
    }
    x = reset;
  }
  return <div>{x}</div>;
}

export function InANestedFunction() {
  let x = 0;
  try {
  } catch (error) {
    const later = () => () => {
      error = null;
    };
    x = later;
  }
  return <div>{x}</div>;
}

export function WithFinally() {
  let x = 0;
  try {
  } catch (error) {
    const reset = () => {
      error = null;
    };
    x = reset;
  } finally {
    x = 3;
  }
  return <div>{x}</div>;
}

export function InALoop(props) {
  let x = 0;
  for (const item of props.items) {
    try {
    } catch (error) {
      const reset = () => {
        error = item;
      };
      x = reset;
    }
  }
  return <div>{x}</div>;
}

export function WrittenAndReadByTwo() {
  let x = 0;
  try {
  } catch (error) {
    const reset = () => {
      error = null;
    };
    const read = () => error;
    x = [reset, read];
  }
  return <div>{x}</div>;
}

export function WrittenOutsideAndRead() {
  let x = 0;
  try {
  } catch (error) {
    error = null;
    x = () => error;
  }
  return <div>{x}</div>;
}

export function OnlyRead() {
  let x = 0;
  try {
  } catch (error) {
    const read = () => error;
    x = read;
  }
  return <div>{x}</div>;
}

export function WrittenOutside() {
  let x = 0;
  try {
  } catch (error) {
    error = null;
    x = error;
  }
  return <div>{x}</div>;
}

export function AnotherVariable() {
  let x = 0;
  try {
  } catch (error) {
    let other = 1;
    const reset = () => {
      other = 2;
    };
    x = reset;
  }
  return <div>{x}</div>;
}

export function AfterADeclaration() {
  let x = 0;
  try {
    const unused = 1;
  } catch (error) {
    const reset = () => {
      error = null;
    };
    x = reset;
  }
  return <div>{x}</div>;
}

export function Reachable(props) {
  let x = 0;
  try {
    props.load();
  } catch (error) {
    const reset = () => {
      error = null;
    };
    x = reset;
  }
  return <div>{x}</div>;
}
`,
};

/** A property key that's half of a surrogate pair can't be compiled. A string value can. */
const loneSurrogates: Files = {
  ".oxlintrc.json": rc(),
  "keys.jsx": `export function Lead() {
  return <div>{{ "\\uD800": 1 }["\\uD800"]}</div>;
}

export function Trail() {
  return <div>{{ "\\uDC00": 2 }["\\uDC00"]}</div>;
}

export const Arrow = () => <div>{{ "\\uD800": 3 }["\\uD800"]}</div>;

export function Computed() {
  return <div>{{ ["\\uD800"]: 4 }["\\uD800"]}</div>;
}

export function Destructured({ "\\uD800": value }) {
  return <div>{value}</div>;
}

export function Assigned(props) {
  let value;
  ({ "\\uDC00": value } = props);
  return <div>{value}</div>;
}

export function Method() {
  const object = {
    "\\uD800"() {
      return 5;
    },
  };
  return <div>{object["\\uD800"]()}</div>;
}

export function InANestedFunction() {
  const read = () => {
    return { "\\uDC00": 6 }["\\uDC00"];
  };
  return <div>{read()}</div>;
}

export function Pairs() {
  return <div>{{ "\\uD800\\uDC00": 7, "\\uFFFDd800": 8 }["\\uD800\\uDC00"]}</div>;
}

export function Reversed() {
  return <div>{{ "\\uDC00\\uD800": 9 }.length}</div>;
}

export function Braces() {
  return <div>{{ "\\u{D800}": 10, "a\\u{DFFF}b": 11 }.a}</div>;
}

export function SingleQuotes() {
  return <div>{{ '\\uD83D': 12 }.a}</div>;
}

export function Getter() {
  const object = {
    get "\\uD800"() {
      return 13;
    },
  };
  return <div>{object.a}</div>;
}
`,
  "values.jsx": `import { useRef } from "react";

export function Values() {
  const ref = useRef(null);
  return <Emoji codepoints={["\\uD83E", "\\uDD21"]} size={16} title={ref.current} />;
}

export function MemberAccess(props) {
  const ref = useRef(null);
  return <div>{props["\\uD800"]}{props.items["\\uDC00"]}{ref.current}</div>;
}

export function Template(props) {
  const ref = useRef(null);
  const text = \`\\uD800\${props.a}\\uDC00\`;
  return <div>{text}{ref.current}</div>;
}

export function Entities() {
  const ref = useRef(null);
  return (
    <div title="&#xD800;" pair="&#xD83D;&#xDE00;" mixed="x&#xDC00;y" data-ref={ref.current}>
      &#xD800;{"&#xD800;"}&#xD83D;&#xDE00;
    </div>
  );
}

export function Attribute() {
  const ref = useRef(null);
  return <div title="\\uD800" data-ref={ref.current} />;
}
`,
};

type Folded = { holds: string[]; fails: string[]; unknown: string[] };
/** What constant propagation makes of each test: `true`, `false`, or nothing. */
export const foldedTests: Record<string, Folded> = {
  "bigint-tests.jsx": {
    holds: [
      "1n",
      "!0n",
      "!0x0n",
      "1n === 1n",
      "0x10n === 16n",
      "1_000n === 1000n",
      "0b11n == 3n",
      "0o17n == 15n",
      "1n != 2n",
      "1n !== 2n",
      "1n !== 1",
      "1n !== null",
      '`${1n}` === "1"',
      '`${0x10n}px` === "16px"',
      "`${0n}`",
      "123456789012345678901234567890n === 123456789012345678901234567890n",
      "0x18ee90ff6c373e0ee4e3f0ad2n === 123456789012345678901234567890n",
    ],
    fails: [
      "0n",
      "0x0n",
      "0b0n",
      "0o0n",
      "!1n",
      "1n === 2n",
      "1n !== 1n",
      "1n != 1n",
      "1n === 1",
      '1n === "1"',
      "1n === null",
      "0n === false",
      '`${1n}` === "1n"',
      "123456789012345678901234567890n === 123456789012345678901234567891n",
    ],
    unknown: [
      "1n == null",
      "null == 0n",
      "1n != null",
      "0n == undefined",
      "1n == 1",
      "1 == 1n",
      "1n != 1",
      '1n == "1"',
      "0n == false",
      "true == 1n",
      "1n === undefined",
      "-1n",
      "1n + 1n",
      "1n - 1n",
      "2n * 2n",
      "2n ** 2n",
      "1n < 2n",
      "1n >= 1n",
      "1n | 1n",
      'typeof 1n === "bigint"',
      "-0n === 0n",
    ],
  },
  "surrogate-tests.jsx": {
    holds: [
      '"\\uD800"',
      '"\\uD800" === "\\uD800"',
      '"\\uD800" == "\\uD800"',
      '"\\uD800" !== "\\uDC00"',
      '"\\uD800" != 1',
      '"\\uD83D\\uDE00".length === 2',
      '"\\uD83D\\uDE00" + "a" === "\\u{1F600}a"',
      '`\\uD83D\\uDE00` === "\\u{1F600}"',
      '`${"\\uD83D\\uDE00"}`.length === 2',
      '"\\u{1F600}".length === 2',
    ],
    fails: [
      '!"\\uD800"',
      '"\\uD800" === "\\uDC00"',
      '"\\uD800" == 1',
      '1 == "\\uDC00"',
      '"\\uD800" === "\\uFFFD"',
      '"\\uD800" == null',
    ],
    unknown: [
      '"\\uD800".length',
      '"\\uD800".length === 1',
      '"a\\uDC00b".length === 3',
      '"\\uD800" + "a"',
      '"a" + "\\uDC00"',
      '"\\uD83D" + "\\uDE00"',
      '("\\uD800" + "").length',
      "`\\uD800`",
      "`\\uD800`.length",
      '`a${"\\uD800"}b`',
      "`\\uD800${1}`",
      "`${1}\\uDC00`",
      '`${"a"}\\uD800${"b"}`',
      '`${"\\uD83D"}${"\\uDE00"}`',
      "`\\uD83D${1}\\uDE00`",
      "`\\u{D800}`",
    ],
  },
};

/**
 * For each test a component that calls a hook if the test holds, which is reported unless the test is folded, and one
 * that sets state if it holds, which is reported if the test is folded to true. The hook of test `i` is on line
 * `11 * i + 4` and the state on line `11 * i + 10`.
 */
const tested = ({ holds, fails, unknown }: Folded) =>
  `import { useState } from "react";\n${[...holds, ...fails, ...unknown]
    .map(
      (test, i) => `
export function Hook${i}() {
  if (${test}) useState(0);
  return <div />;
}

export function State${i}() {
  const [state, setState] = useState(0);
  if (${test}) setState(1);
  return <div>{state}</div>;
}
`,
    )
    .join("")}`;

/** oxc folds a `bigint` by its value, and no string with half of a surrogate pair into another or into its length. */
const foldedConstants: Files = {
  ".oxlintrc.json": rc(),
  "bigint-tests.jsx": tested(foldedTests["bigint-tests.jsx"]),
  "surrogate-tests.jsx": tested(foldedTests["surrogate-tests.jsx"]),
  "bigints.jsx": `import { useEffect, useMemo, useRef, useState } from "react";

export function NotZero() {
  const ref = useRef(null);
  const one = 1n;
  if (one) {
    return <div />;
  }
  return <div>{ref.current}</div>;
}

export function Zero() {
  const ref = useRef(null);
  const zero = 0x0n;
  if (zero) {
    return <div />;
  }
  return <div>{ref.current}</div>;
}

export function Nullish() {
  const ref = useRef(null);
  if (1n == null) {
    return <div>{ref.current}</div>;
  }
  return null;
}

export function NullishAndBound() {
  const zero = 0n;
  if (zero == null) {
    useEffect(() => {});
  }
  return <div />;
}

export function Same() {
  const ref = useRef(null);
  if (0x10n === 16n) {
    return null;
  }
  return <div>{ref.current}</div>;
}

export function TheSameOnEachPath({ on }) {
  let size = 1n;
  if (on) {
    size = 0x1n;
  }
  if (size) {
    useEffect(() => {});
  }
  return <div />;
}

export function AnotherOnOnePath({ on }) {
  let size = 1n;
  if (on) {
    size = 2n;
  }
  if (size) {
    useEffect(() => {});
  }
  return <div />;
}

export function ANumberOnOnePath({ on }) {
  let size = 1n;
  if (on) {
    size = 1;
  }
  if (size) {
    useEffect(() => {});
  }
  return <div />;
}

export function Incremented() {
  let count = 0n;
  count++;
  if (count) {
    useEffect(() => {});
  }
  return <div />;
}

export function PrefixDecremented() {
  let count = 1n;
  if (--count) {
    useEffect(() => {});
  }
  return <div />;
}

export function Negative() {
  const [state, setState] = useState(0);
  const less = -1n;
  if (less) {
    setState(1);
  }
  return <div>{state}</div>;
}

export function Not() {
  const [state, setState] = useState(0);
  const zero = 0n;
  if (!zero) {
    setState(1);
  }
  return <div>{state}</div>;
}

export function InATemplate() {
  const [state, setState] = useState(0);
  const big = 0x10n;
  const text = \`\${big}px\`;
  if (text === "16px" && text.length === 4) {
    setState(1);
  }
  return <div>{state}</div>;
}

export function InACallback() {
  const ref = useRef(null);
  const one = 1n;
  const read = () => {
    if (one === 1n) {
      return null;
    }
    return ref.current;
  };
  return <div>{read()}</div>;
}

export function Dependency({ a }) {
  const big = 10n;
  const listed = useMemo(() => [a], [a, big]);
  const used = useMemo(() => [a, big], [a]);
  useEffect(() => {
    console.log(big);
  }, []);
  return <div>{listed}{used}</div>;
}

export function Key({ items }) {
  const ref = useRef(null);
  const first = items[0n];
  items[1n] = first;
  return <div a={-1n} b={typeof first === "bigint" ? ref.current : 0} />;
}

export function KeyOfARef() {
  const ref = useRef(null);
  const key = 0n;
  return <div>{ref[key]}{ref[0n]}</div>;
}
`,
  "surrogates.jsx": `import { useEffect, useRef, useState } from "react";

export function Length() {
  const half = "\\uD800";
  if (half.length === 1) {
    useState(0);
  }
  return <div />;
}

export function LengthOfAPair() {
  const [state, setState] = useState(0);
  const pair = "\\uD83D\\uDE00";
  if (pair.length === 2) {
    setState(1);
  }
  return <div>{state}</div>;
}

export function Concatenated() {
  const text = "\\uD800" + "a";
  if (text === "x") {
    useState(0);
  }
  return <div />;
}

export function HalvesConcatenated() {
  const ref = useRef(null);
  const lead = "\\uD83D";
  const trail = "\\uDE00";
  if (lead + trail) {
    return <div />;
  }
  return <div>{ref.current}</div>;
}

export function InATemplate() {
  const text = \`a\${"\\uD800"}b\`;
  if (text) {
    useState(0);
  }
  return <div />;
}

export function InAQuasi({ on }) {
  const ref = useRef(null);
  const text = \`\\uDC00\`;
  if (text) {
    return <div />;
  }
  return <div>{ref.current}</div>;
}

export function TruthyAndEqual() {
  const half = "\\uD800";
  if (half) {
    useState(0);
  }
  if (half == "\\uD800") {
    useEffect(() => {});
  }
  return <div />;
}

export function TheSameOnEachPath({ on }) {
  let half = "\\uD800";
  if (on) {
    half = "\\u{D800}";
  }
  if (half) {
    useEffect(() => {});
  }
  return <div />;
}

export function InACallback() {
  const ref = useRef(null);
  const half = "\\uDC00";
  const read = () => {
    if (half.length) {
      return null;
    }
    return ref.current;
  };
  return <div>{read()}</div>;
}
`,
};

/** A component that reads a ref during render, and `props` followed by `members`. */
const chained = (
  members: string,
  use = (chain: string) => `const value = ${chain};`,
) => `import { useRef } from "react";

export function Chain(props) {
  const ref = useRef(0);
  const bad = ref.current;
  ${use(`props${members}`)}
  return <div>{bad}</div>;
}
`;
const members = (n: number, member = ".a") => Buffer.alloc(n * member.length, member).toString();

/** A function with a chain of more than 500 members isn't compiled. */
const memberChains: Files = {
  ".oxlintrc.json": rc(),
  "499.jsx": chained(members(499)),
  "500.jsx": chained(members(500)),
  "501.jsx": chained(members(501)),
  "5000.jsx": chained(members(5000)),
  "computed-500.jsx": chained(members(500, "[0]")),
  "computed-501.jsx": chained(members(501, "[0]")),
  "optional-500.jsx": chained(members(500, "?.a")),
  "optional-501.jsx": chained(members(501, "?.a")),
  "call-in-the-middle.jsx": chained(`${members(300)}()${members(300)}`),
  "call-at-the-end-500.jsx": chained(`${members(500)}()`),
  "call-at-the-end-501.jsx": chained(`${members(501)}()`),
  "in-a-callback-501.jsx": chained(members(501), chain => `const value = () => ${chain};`),
  "assigned-500.jsx": chained(members(500), chain => `const write = () => {\n    ${chain} = 1;\n  };`),
  "assigned-501.jsx": chained(members(501), chain => `const write = () => {\n    ${chain} = 1;\n  };`),
  "two-chains.jsx": chained(members(300), chain => `const value = [${chain}, ${chain}];`),
  "another-component.jsx": `${chained(members(501))}
export function Short(props) {
  const ref = useRef(0);
  return <div>{ref.current}{props.a.a.a}</div>;
}
`,
};

/** Functions that access a ref have the same type wherever in the function the access is. */
const refTypes: Files = {
  ".oxlintrc.json": rc(),
  "convergence.jsx": `import { useEffect, useMemo, useRef } from "react";

export function RecursiveClosure() {
  useEffect(() => {
    let config = { onEvent: () => {} };
    subscribe(() => {
      config = { ...config };
    });
  }, []);
  return <div />;
}

export function RecursiveLoop({ items }) {
  let x = () => {};
  for (const item of items) {
    x = { x };
  }
  return <div onClick={x} />;
}

export function PhiJoin({ cond }) {
  const ref1 = useRef(null);
  const ref2 = useRef(null);
  const chosen = cond ? ref1 : ref2;
  return <div ref={chosen} />;
}

export function useCancellableDebounce(fn, time) {
  const timeoutRef = useRef(null);
  return useMemo(() => {
    const cancel = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
    const debounced = (...args) => {
      cancel();
      timeoutRef.current = setTimeout(() => fn(...args), time);
    };
    debounced.cancel = cancel;
    return debounced;
  }, [fn, time]);
}

export function WhileLoop({ depth }) {
  let wrap = () => null;
  let n = depth;
  while (n > 0) {
    wrap = [wrap];
    n = n - 1;
  }
  return <div onClick={wrap} />;
}

export function RefInALoop({ items }) {
  const ref = useRef(null);
  let read = () => ref.current;
  for (const item of items) {
    read = { read, item };
  }
  return <List read={read} />;
}

export function TwoClosures() {
  const ref = useRef(0);
  let handler = () => {
    ref.current = 1;
  };
  useEffect(() => {
    handler = () => {
      ref.current = 2;
      handler();
    };
  }, []);
  return <div onClick={handler} />;
}

export function Reassigned({ flag }) {
  const ref = useRef(0);
  let get = () => ref.current;
  if (flag) {
    get = () => ref.current + 1;
  }
  return <div onClick={get} />;
}
`,
};

/** The message for modifying `.current` suggests a name that ends in "Ref". */
const refHints: Files = {
  ".oxlintrc.json": rc(),
  "hints.tsx": `import { useEffect, useRef } from "@wordpress/element";

export function AssignsCurrent({ value }) {
  value.current = true;
  return <div />;
}

export function InAnEffect({ foo }) {
  useEffect(() => {
    foo.current = true;
  }, [foo]);
}

export function Context() {
  const FooContext = useContext(Foo);
  const onClick = () => {
    FooContext.current = true;
  };
  return <div onClick={onClick} />;
}

export function useLatest<T>(value: T) {
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  return () => latest.current;
}

export function Clicks() {
  const clicks = useRef(0);
  return (
    <button
      onClick={() => {
        clicks.current += 1;
      }}
    />
  );
}

export function useLatestRef<T>(value: T) {
  const latestRef = useRef(value);
  useEffect(() => {
    latestRef.current = value;
  });
  return () => latestRef.current;
}

export function NamedRef({ valueRef }) {
  valueRef.current = true;
  return <div />;
}

export function OtherProperty({ value }: { value: { other: boolean } }) {
  value.other = true;
  return <div />;
}

export function Nested({ value }) {
  value.current.inner = true;
  return <div />;
}

export function ComputedCurrent({ value }) {
  value["current"] = true;
  return <div />;
}

export function Updates({ value }) {
  value.current++;
  return <div />;
}

export function Deletes({ value }) {
  delete value.current;
  return <div />;
}

export function State() {
  const [state] = useState({ current: 0 });
  state.current = 1;
  return <div />;
}

export function HookResult() {
  const store = useStore();
  const onClick = () => {
    store.current = null;
  };
  return <div onClick={onClick} />;
}
`,
};

/** A function that's captured by an event handler isn't called during render, even in a callback that is. */
const capturedFunctions: Files = {
  ".oxlintrc.json": rc(),
  "handlers-in-a-map.jsx": `const ITEMS = [{ id: "a" }, { id: "b" }];

export function HelperCalledFromAHandler({ onPick }) {
  function handlePick(item) {
    onPick(item.id, Date.now());
  }
  return (
    <div>
      {ITEMS.map(item => (
        <button key={item.id} onClick={() => handlePick(item)} />
      ))}
    </div>
  );
}

export function InlineHandler() {
  return (
    <div>
      {ITEMS.map(item => (
        <button key={item.id} onClick={() => Date.now()} />
      ))}
    </div>
  );
}

export function HandlerPassedByName() {
  function handlePick() {
    Math.random();
  }
  return (
    <div>
      {ITEMS.map(item => (
        <button key={item.id} onClick={handlePick} />
      ))}
    </div>
  );
}

export function OutsideTheMap({ onPick }) {
  function handlePick(item) {
    onPick(item.id, Date.now());
  }
  return (
    <div>
      <button onClick={() => handlePick(ITEMS[0])} />
    </div>
  );
}

export function InTheMapCallback() {
  return <div>{ITEMS.map(item => Date.now())}</div>;
}

export function HelperCalledFromTheMapCallback() {
  function getTime() {
    return Date.now();
  }
  return <div>{ITEMS.map(item => getTime())}</div>;
}

export function ArrowHelper({ onPick }) {
  const stamp = item => onPick(item.id, performance.now());
  return (
    <ul>
      {ITEMS.filter(item => item.id).map(item => (
        <li key={item.id} onClick={() => stamp(item)} onKeyDown={event => stamp(event.target)} />
      ))}
    </ul>
  );
}

export function TwoLevels({ groups, onPick }) {
  function handlePick(item) {
    onPick(item.id, Math.random());
  }
  return (
    <div>
      {groups.map(group => (
        <ul key={group.id}>
          {group.items.map(item => (
            <li key={item.id} onClick={() => handlePick(item)} />
          ))}
        </ul>
      ))}
    </div>
  );
}

export function HandlerAndCall({ onPick }) {
  function stamp(item) {
    return onPick(item.id, Date.now());
  }
  return (
    <div>
      {ITEMS.map(item => (
        <button key={item.id} onClick={() => stamp(item)}>
          {stamp(item)}
        </button>
      ))}
    </div>
  );
}
`,
  "mutating-callbacks.jsx": `function callLater(fn) {
  fn();
}

export function DirectCall(props) {
  const arr = [];
  const push = () => {
    arr.push(props.x);
  };
  const run = () => {
    push();
  };
  callLater(run);
  return <div>{arr}</div>;
}

export function NestedCall(props) {
  const arr = [];
  const push = () => {
    arr.push(props.x);
  };
  const run = () => {
    [0].forEach(() => push());
  };
  callLater(run);
  return <div>{arr}</div>;
}

export function AfterItsFrozen(props) {
  const arr = [];
  const push = () => {
    arr.push(props.x);
  };
  const run = () => {
    push();
  };
  const element = <div>{arr}</div>;
  callLater(run);
  return element;
}

export function CapturedNotCalled(props) {
  const push = () => {
    props.items.push(1);
  };
  const run = () => push;
  return <button onClick={run()} />;
}

export function CapturedAndCalled(props) {
  const push = () => {
    props.items.push(1);
  };
  const run = () => push();
  run();
  return <div />;
}
`,
};

/** A manual dependency with optional and non-optional members. */
const optionalDependencies: Files = {
  ".oxlintrc.json": rc(),
  "mixed.jsx": `import { useCallback, useMemo } from "react";

export function Mixed({ x }) {
  const object = useMemo(() => {
    return identity({
      callback: () => {
        return identity(x.a.b?.c.d?.e);
      },
    });
  }, [x.a.b?.c.d?.e]);
  const result = useMemo(() => {
    return [object.callback()];
  }, [object]);
  return <Inner x={x} result={result} />;
}

export function Shorter({ x }) {
  const callback = useCallback(() => identity(x.a?.b.c), [x.a?.b.c]);
  return <Inner callback={callback} />;
}

export function OptionalFirst({ x }) {
  const callback = useCallback(() => identity(x?.a.b?.c), [x?.a.b?.c]);
  return <Inner callback={callback} />;
}

export function AllOptional({ x }) {
  const callback = useCallback(() => identity(x?.a?.b?.c), [x?.a?.b?.c]);
  return <Inner callback={callback} />;
}

export function NoneOptional({ x }) {
  const callback = useCallback(() => identity(x.a.b.c), [x.a.b.c]);
  return <Inner callback={callback} />;
}

export function InAMemo({ x }) {
  const value = useMemo(() => identity(x.a.b?.c.d?.e), [x.a.b?.c.d?.e]);
  return <Inner value={value} />;
}

export function ListedShorter({ x }) {
  const callback = useCallback(() => identity(x.a.b?.c.d), [x.a.b]);
  return <Inner callback={callback} />;
}
`,
  "non-null.tsx": `import { useCallback, useMemo } from "react";

export function NonNull({ x }) {
  const callback = useCallback(() => identity(x.a!.b?.c), [x.a!.b?.c]);
  return <Inner callback={callback} />;
}

export function NonNullAfterOptional({ x }) {
  const callback = useCallback(() => identity(x.a?.b!.c), [x.a?.b!.c]);
  return <Inner callback={callback} />;
}

export function InAMemo({ x }) {
  const value = useMemo(() => identity(x?.a!.b), [x?.a!.b]);
  return <Inner value={value} />;
}
`,
};

/**
 * `using` and `await using`. oxlint 1.87 reported nothing in a function with one of them, unless it was the variable
 * of a `for`-`of` loop.
 */
const usingDeclarations: Files = {
  ".oxlintrc.json": rc(),
  "using.ts": `import { useRef } from "react";

export function useResource(props) {
  const ref = useRef(0);
  using handle = props.open();
  const bad = ref.current;
  return bad + handle.value;
}

export function useBefore(props) {
  using handle = props.open();
  const ref = useRef(0);
  return ref.current + handle.value;
}

export function useTwo(props) {
  const ref = useRef(0);
  using first = props.open(), second = props.open();
  return ref.current + first.value + second.value;
}

export function useControl(props) {
  const ref = useRef(0);
  const handle = props.open();
  const bad = ref.current;
  return bad + handle.value;
}
`,
  "using.tsx": `import { useRef, useState } from "react";

export function Component(props) {
  using resource = open(props.a);
  const ref = useRef(0);
  return <div>{ref.current}{resource.value}</div>;
}

export function Typed(props: { a: string }) {
  using resource: Disposable = open(props.a);
  const ref = useRef<number>(0);
  return <div>{ref.current}</div>;
}

export function Impure(props) {
  using resource = open(Math.random());
  return <div>{resource.value}</div>;
}

export function SetsState(props) {
  const [state, setState] = useState(0);
  using resource = open(props.a);
  setState(1);
  return <div>{state}{resource.value}</div>;
}

export function Mutated(props) {
  using resource = open(props.a);
  const element = <div>{resource}</div>;
  resource.value = 1;
  return element;
}

export function MutatesProps(props) {
  using resource = props.resource;
  resource.value = 1;
  return <div>{resource.value}</div>;
}

export function Reassigned(props) {
  using resource = open(props.a);
  resource = null;
  return <div>{resource}</div>;
}

export function Null(props) {
  using resource = null;
  const ref = useRef(0);
  return <div>{ref.current}{resource}</div>;
}
`,
  "await-using.ts": `import { useRef } from "react";

export async function useResource(props) {
  const ref = useRef(0);
  await using handle = props.open();
  const bad = ref.current;
  return bad + handle.value;
}

export async function useControl(props) {
  const ref = useRef(0);
  const handle = await props.open();
  const bad = ref.current;
  return bad + handle.value;
}
`,
  "await-using.tsx": `import { useRef } from "react";

export async function Component(props) {
  await using resource = open(props.a);
  const ref = useRef(0);
  return <div>{ref.current}{resource.value}</div>;
}

export const Arrow = async props => {
  await using resource = open(props.a);
  const ref = useRef(0);
  return <div>{ref.current}{resource.value}</div>;
};

export async function Impure(props) {
  await using resource = open(Math.random());
  return <div>{resource.value}</div>;
}

export async function Mutated(props) {
  await using resource = open(props.a);
  const element = <div>{resource}</div>;
  resource.value = 1;
  return element;
}
`,
  "captured.tsx": `import { useCallback, useEffect, useMemo, useRef } from "react";

export function Handler(props) {
  using resource = open(props.a);
  const ref = useRef(0);
  const onClick = () => resource.close();
  return <button onClick={onClick}>{ref.current}</button>;
}

export function Memoized(props) {
  using resource = open(props.a);
  const onClick = useCallback(() => resource.close(), []);
  const value = useMemo(() => resource.value, []);
  return <button onClick={onClick}>{value}</button>;
}

export function Listed(props) {
  using resource = open(props.a);
  const onClick = useCallback(() => resource.close(), [resource]);
  return <button onClick={onClick} />;
}

export function Effect(props) {
  using resource = open(props.a);
  useEffect(() => {
    resource.value = props.a;
  }, []);
  return <div />;
}

export function MutatedInRender(props) {
  using resource = open(props.a);
  const write = () => {
    resource.value = 1;
  };
  const element = <div>{resource}</div>;
  write();
  return element;
}

export function ReassignedInCallback(props) {
  using resource = open(props.a);
  const reset = () => {
    resource = null;
  };
  return <button onClick={reset}>{resource.value}</button>;
}

export async function Awaited(props) {
  await using resource = open(props.a);
  const ref = useRef(0);
  const onClick = () => resource.close();
  return <button onClick={onClick}>{ref.current}</button>;
}
`,
  "nested.tsx": `import { useEffect, useRef } from "react";

export function InABlock(props) {
  const ref = useRef(0);
  {
    using resource = open(props.a);
    resource.use();
  }
  return <div>{ref.current}</div>;
}

export function InABranch(props) {
  const ref = useRef(0);
  if (props.a) {
    using resource = open(props.a);
    return <div>{resource.value}</div>;
  }
  return <div>{ref.current}</div>;
}

export function InATry(props) {
  const ref = useRef(0);
  try {
    using resource = open(props.a);
    resource.use();
  } catch {}
  return <div>{ref.current}</div>;
}

export function InACallback(props) {
  const ref = useRef(0);
  const onClick = () => {
    using resource = open(props.a);
    resource.use();
  };
  return <button onClick={onClick}>{ref.current}</button>;
}

export function InAnAsyncCallback(props) {
  const ref = useRef(0);
  const onClick = async () => {
    await using resource = open(props.a);
    resource.use();
  };
  return <button onClick={onClick}>{ref.current}</button>;
}

export function InAnEffect(props) {
  const ref = useRef(0);
  useEffect(() => {
    using resource = open(props.a);
    resource.use();
  }, []);
  return <div>{ref.current}</div>;
}

export function RefInACallback(props) {
  const ref = useRef(0);
  const read = () => {
    using resource = open(props.a);
    return ref.current + resource.value;
  };
  return <div>{read()}</div>;
}
`,
  "loops.tsx": `import { useRef } from "react";

export function ForOf(props) {
  const ref = useRef(0);
  for (using resource of props.resources) {
    resource.use();
  }
  return <div>{ref.current}</div>;
}

export async function ForAwaitOf(props) {
  const ref = useRef(0);
  for await (await using resource of props.resources) {
    resource.use();
  }
  return <div>{ref.current}</div>;
}

export async function ForOfAwaitUsing(props) {
  const ref = useRef(0);
  for (await using resource of props.resources) {
    resource.use();
  }
  return <div>{ref.current}</div>;
}

export function For(props) {
  const ref = useRef(0);
  for (using resource = open(props.a); resource.more(); ) {
    resource.use();
  }
  return <div>{ref.current}</div>;
}

export function InALoopBody(props) {
  const ref = useRef(0);
  for (const item of props.items) {
    using resource = open(item);
    resource.use();
  }
  return <div>{ref.current}</div>;
}
`,
  "not-a-declaration.jsx": `import { useRef } from "react";

export function Identifier(props) {
  const ref = useRef(0);
  const using = props.using;
  using.value;
  return <div>{ref.current}{using}</div>;
}
`,
};

/**
 * Writes to a value that's also an operand of an operator. oxlint 1.87 only reported the ones at lines 34, 48, 64, 102
 * and 148.
 */
const operatorOperands: Files = {
  ".oxlintrc.json": rc(),
  "operands.jsx": `import { useEffect, useState } from "react";

export function Subtract(props) {
  const x = props.value;
  const y = x - 1;
  x.a = 2;
  return <div>{y}</div>;
}

export function Add(props) {
  const x = props.value;
  const y = x + 1;
  x.a = 2;
  return <div>{y}</div>;
}

export function Multiply(props) {
  const x = props.value;
  const y = 2 * x;
  x.a = 2;
  return <div>{y}</div>;
}

export function Less(props) {
  const x = props.value;
  const y = x < 1;
  x.a = 2;
  return <div>{y}</div>;
}

export function Equal(props) {
  const x = props.value;
  const y = x === 1;
  x.a = 2;
  return <div>{y}</div>;
}

export function Shift(props) {
  const x = props.value;
  const y = x >> 1;
  x.a = 2;
  return <div>{y}</div>;
}

export function In(props) {
  const x = props.value;
  const y = "a" in x;
  x.a = 2;
  return <div>{y}</div>;
}

export function Both(props) {
  const x = props.value;
  const z = props.other;
  const y = x - z;
  x.a = 2;
  z.a = 2;
  return <div>{y}</div>;
}

export function Negate(props) {
  const x = props.value;
  const y = -x;
  x.a = 2;
  return <div>{y}</div>;
}

export function Update(props) {
  let x = props.value;
  const before = x;
  x++;
  before.a = 2;
  return <div>{x}</div>;
}

export function Compound(props) {
  const x = props.value;
  let y = 1;
  y -= x;
  x.a = 2;
  return <div>{y}</div>;
}

export function AfterTheWrite(props) {
  const x = props.value;
  x.a = 2;
  const y = x - 1;
  return <div>{y}</div>;
}

export function State() {
  const [x] = useState({});
  const y = x - 1;
  x.a = 2;
  return <div>{y}</div>;
}

export function Local(props) {
  const x = makeObject(props.a);
  const y = x - 1;
  const element = <div>{x}</div>;
  x.a = 2;
  return element;
}

export function InAnEffect(props) {
  const x = props.value;
  useEffect(() => {
    const y = x - 1;
    x.a = y;
  });
  return <div />;
}

export function InAHandler(props) {
  const x = props.value;
  const onClick = () => {
    const y = x - 1;
    x.a = y;
  };
  return <button onClick={onClick} />;
}

export function CalledInRender(props) {
  const x = props.value;
  const write = () => {
    const y = x - 1;
    x.a = y;
  };
  write();
  return <div />;
}

export function Parameter({ value }) {
  const y = value - 1;
  value.a = 2;
  return <div>{y}</div>;
}

export function useSubtract(value) {
  const y = value - 1;
  value.a = 2;
  return y;
}

export function NoOperator(props) {
  const x = props.value;
  x.a = 2;
  return <div>{x}</div>;
}
`,
};

/**
 * A `useMemo` callback that creates an object or an array and then a second one, with an operator in between whose
 * operands are a reactive value and one that isn't. oxlint 1.95 merges the two scopes, and what the merged scope
 * depends on is the operands themselves, so the one that isn't reactive is a dependency that isn't listed. oxlint 1.87
 * only reported `Path` and `Computed`. From `Path` on the functions are reported as they were, or not at all.
 */
const mergedMemoScopes: Files = {
  ".oxlintrc.json": rc(),
  "merged.jsx": `import { useCallback, useMemo, useRef, useState } from "react";

export function Template({ id }) {
  const x = globalFn() + 1;
  return useMemo(() => ({ entries: new Map(), key: \`k-\${x}-\${id}\` }), [id]);
}

export function Sum({ id }) {
  const x = globalFn() + 1;
  return useMemo(() => ({ entries: new Map(), key: x + id }), [id]);
}

export function Setter({ id }) {
  const [state, setState] = useState(0);
  const value = useMemo(() => ({ entries: new Map(), key: \`\${id}-\${setState}\` }), [id]);
  return <div>{value}{state}</div>;
}

export function Ref({ id }) {
  const ref = useRef(null);
  const value = useMemo(() => [{ label: "Home" }, { label: id + ref }], [id]);
  return <div>{value}</div>;
}

export function Less({ id }) {
  const x = globalFn() + 1;
  return useMemo(() => [new Set(), { small: x < id }], [id]);
}

export function Stored({ id }) {
  const x = globalFn() + 1;
  return useMemo(() => {
    const entries = new Map();
    const key = x * id;
    return { entries, key };
  }, [id]);
}

export function Two({ id }) {
  const x = globalFn() + 1;
  const y = globalFn() + 2;
  return useMemo(() => ({ entries: new Map(), key: x + id + y }), [id]);
}

export function Three({ id }) {
  const x = globalFn() + 1;
  return useMemo(() => ({ first: [], second: new Set(), key: id - x }), [id]);
}

export function Path({ id }) {
  const x = globalFn();
  return useMemo(() => ({ entries: new Map(), key: x.a.b + id }), [id]);
}

export function Computed({ id }) {
  const x = globalFn();
  return useMemo(() => ({ entries: new Map(), key: x[id] }), [id]);
}

export function Listed({ id }) {
  const x = globalFn() + 1;
  return useMemo(() => ({ entries: new Map(), key: x + id }), [id, x]);
}

export function Negated({ id }) {
  const x = globalFn() + 1;
  return useMemo(() => [[], -x, id], [id]);
}

export function NoReactiveOperand() {
  const x = globalFn() + 1;
  return useMemo(() => [[], { key: x + 1 }], []);
}

export function NoOperator({ id }) {
  const [state, setState] = useState(0);
  const value = useMemo(() => ({ entries: new Map(), key: id.a.b, set: setState }), [id.a.b]);
  return <div>{value}{state}</div>;
}

export function NothingCreatedBefore({ id }) {
  const x = globalFn() + 1;
  return useMemo(() => ({ key: x + id }), [id]);
}

export function CreatedAfter({ id }) {
  const x = globalFn() + 1;
  return useMemo(() => ({ key: x + id, entries: new Map() }), [id]);
}

export function Global({ id }) {
  return useMemo(() => ({ entries: new Map(), key: id.a.b + GLOBAL }), [id.a.b]);
}

export function Callback({ id }) {
  const x = globalFn() + 1;
  return useCallback(() => ({ entries: new Map(), key: x + id }), [id]);
}
`,
};

/**
 * A variable whose value depends on which way a branch went, or on whether a call threw. It's read outside the
 * `useMemo` callback (`const v = value`), because a variable that the callback captures is a dependency either way.
 * oxlint 1.87 reported nothing in these files. The last function of each isn't reported: nothing in it is reactive.
 */
const controlReactivity: Files = {
  ".oxlintrc.json": rc(),
  // The branch is inside a `try` that has a `catch`.
  "branches-in-try.jsx": `import { useMemo } from "react";

const FLAG = globalThis.FLAG;

export function IfInTry({ cond }) {
  let value;
  try {
    if (cond) {
      value = "a";
    } else {
      value = "b";
    }
  } catch {
    value = "c";
  }
  const v = value;
  const m = useMemo(() => [v], []);
  return <div>{m}</div>;
}

export function TernaryInTry({ cond }) {
  let value;
  try {
    value = cond ? "a" : "b";
  } catch {
    value = "c";
  }
  const v = value;
  const m = useMemo(() => [v], []);
  return <div>{m}</div>;
}

export function SwitchInTry({ kind }) {
  let value;
  try {
    switch (kind) {
      case 1:
        value = "a";
        break;
      default:
        value = "d";
    }
  } catch {
    value = "c";
  }
  const v = value;
  const m = useMemo(() => [v], []);
  return <div>{m}</div>;
}

export function ConstantIfInTry() {
  let value;
  try {
    if (FLAG) {
      value = "a";
    } else {
      value = "b";
    }
  } catch {
    value = "c";
  }
  const v = value;
  const m = useMemo(() => [v], []);
  return <div>{m}</div>;
}
`,
  // Whether the `catch` runs depends on a reactive value. In the second one, so does whether the second call runs.
  "throws-in-try.jsx": `import { useMemo } from "react";

const FLAG = globalThis.FLAG;

export function ThrowDependsOnAProp({ value }) {
  let status = "valid";
  try {
    validate(value);
  } catch {
    status = "invalid";
  }
  const v = status;
  const m = useMemo(() => [v], []);
  return <div>{m}</div>;
}

export function ThrowAfterAThrowThatDepends({ value }) {
  let status = "valid";
  try {
    validate(value);
    validate();
  } catch {
    status = "invalid";
  }
  const v = status;
  const m = useMemo(() => [v], []);
  return <div>{m}</div>;
}

export function ConstantThrow() {
  let status = "valid";
  try {
    validate(FLAG);
  } catch {
    status = "invalid";
  }
  const v = status;
  const m = useMemo(() => [v], []);
  return <div>{m}</div>;
}
`,
  // The inner branch, which isn't reactive, is the nearest one that decides whether the assignment is kept.
  "outer-branches.jsx": `import { useMemo } from "react";

const FLAG = globalThis.FLAG;

export function OuterBranch({ prop }) {
  let x = 0;
  if (prop) {
    x = 1;
    if (FLAG) return null;
  }
  const v = x;
  const m = useMemo(() => [v], []);
  return <div>{m}</div>;
}

export function ConstantBranches() {
  let x = 0;
  if (FLAG) {
    x = 1;
    if (FLAG) return null;
  }
  const v = x;
  const m = useMemo(() => [v], []);
  return <div>{m}</div>;
}
`,
};

/**
 * A JSX tag that names a function or a variable that's declared later. oxlint 1.95 declares the name early for a call
 * and for a use as a value, and not for a tag, whether the element is in the component's body or in a callback.
 */
const jsxTags: Files = {
  ".oxlintrc.json": rc(),
  // The element is in the component's body. The last one's tag is declared first.
  "same-function.jsx": `export function ElementBeforeTheDeclaration({ label }) {
  const element = <Row label={label} />;
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return element;
}

export function WithChildren({ label }) {
  const element = <Row>{label}</Row>;
  function Row(props) {
    return <li>{props.children}</li>;
  }
  return element;
}

export function InsideAnotherElement({ label }) {
  const element = (
    <ul>
      <Row label={label} />
    </ul>
  );
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return element;
}

export function InAnAttribute({ label }) {
  const element = <List first={<Row label={label} />} />;
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return element;
}

export function InACondition({ label, shown }) {
  const element = shown ? <Row label={label} /> : null;
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return element;
}

export function InABranch({ label, shown }) {
  let element = null;
  if (shown) {
    element = <Row label={label} />;
  }
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return element;
}

export function MemberOfTheDeclaration({ label }) {
  const element = <Row.Cell label={label} />;
  function Row() {
    return null;
  }
  return element;
}

export function MemberOfAConst({ label }) {
  const element = <Theme.Provider value={label} />;
  const Theme = createTheme();
  return element;
}

export function ConstTag({ label }) {
  const element = <Row label={label} />;
  const Row = props => <li>{props.label}</li>;
  return element;
}

export function AfterTheDeclaration({ label }) {
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return <Row label={label} />;
}
`,
  // The name is also called or used as a value. In the last three that's in a statement after the tag's.
  "other-references.jsx": `export function Called({ label }) {
  const element = Row({ label });
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return <ul>{element}</ul>;
}

export function TagAndValue({ label }) {
  const element = <Row label={label} as={Row} />;
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return element;
}

export function ValueAndTag({ label }) {
  const rows = [Row, <Row label={label} />];
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return rows;
}

export function TagAndCallInAChild({ label }) {
  const element = <Row>{Row({ label })}</Row>;
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return element;
}

export function ValueThenTag({ label }) {
  const same = Row;
  const element = <Row label={label} />;
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return [element, same];
}

export function TagThenValue({ label }) {
  const element = <Row label={label} />;
  const same = Row;
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return [element, same];
}

export function TagThenCall({ label }) {
  const element = <Row label={label} />;
  const called = Row({ label });
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return [element, called];
}

export function TagThenValueInACallback({ label }) {
  const element = <Row label={label} />;
  const same = () => Row;
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return [element, same];
}
`,
  // The element is in a callback or in a function declaration. The last two components have no JSX and no call of a
  // hook outside their callbacks.
  "in-a-callback.jsx": `import { useCallback, useEffect } from "react";

export function CalledInRender({ label }) {
  const render = () => <Row label={label} />;
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return <ul>{render()}</ul>;
}

export function Handler({ label }) {
  const onClick = () => show(<Row label={label} />);
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return <button onClick={onClick} />;
}

export function Effect({ label }) {
  useEffect(() => {
    show(<Row label={label} />);
  });
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return null;
}

export function Memoized({ label }) {
  const render = useCallback(() => <Row label={label} />, [label]);
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return render;
}

export function MapCallback({ labels }) {
  const rows = labels.map(label => <Row key={label} label={label} />);
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return <ul>{rows}</ul>;
}

export function FunctionDeclaration({ label }) {
  const element = render();
  function render() {
    return <Row label={label} />;
  }
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return <ul>{element}</ul>;
}

export function TagAndValue({ label }) {
  const render = () => [<Row label={label} />, Row];
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return <ul>{render()}</ul>;
}

export function TagAndCall({ label }) {
  const render = () => <Row>{Row({ label })}</Row>;
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return <ul>{render()}</ul>;
}

export function ConstTag({ label }) {
  const render = () => <Row label={label} />;
  const Row = props => <li>{props.label}</li>;
  return <ul>{render()}</ul>;
}

export function ConstMember({ label }) {
  const render = () => <Theme.Provider value={label} />;
  const Theme = createTheme();
  return <ul>{render()}</ul>;
}

export function TwoDeep({ label }) {
  const render = () => () => <Row label={label} />;
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return <ul>{render()()}</ul>;
}

export function AfterTheDeclaration({ label }) {
  function Row(props) {
    return <li>{props.label}</li>;
  }
  const render = () => <Row label={label} />;
  return <ul>{render()}</ul>;
}

export function useRow(label) {
  const render = useCallback(() => <Row label={label} />, [label]);
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return render;
}

export function OnlyInACallback({ label }) {
  const render = () => <Row label={label} />;
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return render();
}

export function ConstTagOnlyInACallback({ label }) {
  const render = () => [<Row label={label} />, Row];
  const Row = props => <li>{props.label}</li>;
  return render();
}
`,
  // The declaration comes after a `return`, or after a branch that returns.
  "after-a-return.jsx": `export function Tag({ label }) {
  return <Row label={label} />;

  function Row(props) {
    return <li>{props.label}</li>;
  }
}

export function Member({ label }) {
  return <Row.Cell label={label} />;

  function Row() {}
}

export function Call({ label }) {
  return <ul>{Row({ label })}</ul>;

  function Row(props) {
    return <li>{props.label}</li>;
  }
}

export function TagAndValue({ label }) {
  return <Row label={label} as={Row} />;

  function Row(props) {
    return <li>{props.label}</li>;
  }
}

export function TagInACallback({ labels }) {
  return <ul>{labels.map(label => <Row key={label} label={label} />)}</ul>;

  function Row(props) {
    return <li>{props.label}</li>;
  }
}

export function TagInABranch({ label, shown }) {
  if (shown) {
    return <Row label={label} />;
  }
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return null;
}

export function TagAndValueInABranch({ label, shown }) {
  if (shown) {
    return <Row label={label} as={Row} />;
  }
  function Row(props) {
    return <li>{props.label}</li>;
  }
  return null;
}
`,
};

/** Calls of what upstream's test runner types as functions and hooks of `shared-runtime`, imported from `module`. */
const typedCalls = (module: string) => `import sharedDefault, {
  graphql,
  typedArrayPush,
  typedCapture,
  typedCreateFrom,
  typedLog,
  typedMutate,
  useFragment,
  useFreeze,
  useNoAlias,
} from "${module}";

export function Push(props) {
  typedArrayPush(props.items, 1);
  return <ul>{props.items}</ul>;
}

export function Mutate(props) {
  typedMutate(props.value);
  return <div>{props.value.label}</div>;
}

export function CreateFrom(props) {
  const first = typedCreateFrom(props.value);
  first.label = "changed";
  return <div>{first.label}</div>;
}

export function Capture(props) {
  const boxed = typedCapture(props.value);
  boxed[0].label = "changed";
  return <div>{boxed}</div>;
}

export function Log(props) {
  const items = [props.a];
  typedLog(items);
  items.push(props.b);
  return <ul>{items}</ul>;
}

export function Default(props) {
  const items = [props.a];
  sharedDefault(items);
  items.push(props.b);
  return <ul>{items}</ul>;
}

export function Freeze(props) {
  const items = [];
  useFreeze(items);
  items.push(props.a);
  return <ul>{items}</ul>;
}

export function NoAlias(props) {
  const item = {};
  const other = useNoAlias(item);
  item.a = props.a;
  other.b = props.b;
  return <div>{item.a}</div>;
}

export function Fragment(props) {
  const data = useFragment(graphql\`fragment F on T { id }\`, props.node);
  data.id = 1;
  return <div>{data.id}</div>;
}
`;

/** What upstream's test runner types as incompatible with memoization, imported from `module`. */
const incompatibleCalls = (module: string) => `import {
  knownIncompatible,
  useKnownIncompatible,
  useKnownIncompatibleIndirect,
} from "${module}";

export function Hook() {
  const data = useKnownIncompatible();
  return <div>{data}</div>;
}

export function NotAHook() {
  const data = knownIncompatible();
  return <div>{data}</div>;
}

export function Indirect() {
  const { incompatible } = useKnownIncompatibleIndirect();
  return <div>{incompatible()}</div>;
}
`;

/**
 * What upstream's test runner types as a hook or as no hook against its name, imported from `module`, and a default
 * export that it types as no hook, imported from `defaultModule`.
 */
const hookCalls = (module: string, defaultModule: string) => `import {
  notAhookTypedAsHook,
  useHookNotTypedAsHook,
} from "${module}";
import useDefault from "${defaultModule}";
import notNamedLikeAHook from "${defaultModule}";

export function CalledOnce(props) {
  const a = useHookNotTypedAsHook();
  const b = notAhookTypedAsHook();
  const c = useDefault();
  const d = notNamedLikeAHook();
  return <div>{[a, b, c, d, props.e]}</div>;
}

export function NamedLikeAHook(props) {
  let a = null;
  if (props.cond) {
    a = useHookNotTypedAsHook();
  }
  return <div>{a}</div>;
}

export function NotNamedLikeAHook(props) {
  let a = null;
  if (props.cond) {
    a = notAhookTypedAsHook();
  }
  return <div>{a}</div>;
}

export function DefaultNamedLikeAHook(props) {
  let a = null;
  if (props.cond) {
    a = useDefault();
  }
  return <div>{a}</div>;
}

export function DefaultNotNamedLikeAHook(props) {
  let a = null;
  if (props.cond) {
    a = notNamedLikeAHook();
  }
  return <div>{a}</div>;
}
`;

/**
 * The modules of upstream's test fixtures. Upstream's test runner gives them types, and oxlint 1.95 doesn't: what is
 * imported from one is reported like the same name from a module that nothing knows. The `elsewhere` files import
 * from modules whose names are as long, so that the offsets in their reports are the same too.
 */
const fixtureModules: Files = {
  ".oxlintrc.json": rc(),
  "shared-runtime.jsx": typedCalls("shared-runtime"),
  "shared-runtime-elsewhere.jsx": typedCalls("another-module"),
  "known-incompatible.jsx": incompatibleCalls("ReactCompilerKnownIncompatibleTest"),
  "known-incompatible-elsewhere.jsx": incompatibleCalls("AnotherModuleKnownIncompatibleTest"),
  "hooks.jsx": hookCalls("ReactCompilerTest", "useDefaultExportNotTypedAsHook"),
  "hooks-elsewhere.jsx": hookCalls("AnotherModuleTest", "useAnotherExportNotTypedAsHook"),
  "other-imports.jsx": `import * as SharedRuntime from "shared-runtime";
import { typedMutate as mutate, useKnownIncompatible as useData } from "shared-runtime";
import { useKnownIncompatible as useOther } from "ReactCompilerKnownIncompatibleTest";

export function Namespace(props) {
  SharedRuntime.typedArrayPush(props.items, 1);
  SharedRuntime.typedMutate(props.value);
  return <ul>{props.items}</ul>;
}

export function Renamed(props) {
  mutate(props.value);
  const data = useData();
  const other = useOther();
  return <div>{[data, other, props.value.label]}</div>;
}

export function Required(props) {
  const { typedMutate } = require("shared-runtime");
  typedMutate(props.value);
  return <div>{props.value.label}</div>;
}
`,
  // The libraries that the compiler knows are still typed.
  "real-modules.jsx": `import { useForm } from "react-hook-form";
import { useReactTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

export function Form() {
  const { watch } = useForm();
  const value = watch("a");
  return <div>{value}</div>;
}

export function Table(props) {
  const table = useReactTable({ data: props.data });
  return <div>{table.getRowModel().rows.length}</div>;
}

export function Virtual(props) {
  const virtualizer = useVirtualizer({ count: props.count });
  return <div>{virtualizer.getTotalSize()}</div>;
}
`,
};

/**
 * Callbacks that read `object.a.b` and list `object?.a?.b`. Where the callback is assumed to be called during render,
 * what it reads can be read early and the inferred dependency is `object.a.b`. Where it isn't, it is `object`.
 * oxlint 1.90 assumed the call of a function that's given to JSX, and oxlint 1.93 assumed it from a call in a branch.
 */
const assumedCalls: Files = {
  ".oxlintrc.json": rc(),
  // From `AlsoCalled` on, the callback is called or given to a hook in the component's body, or the list is right.
  // Spread props never showed a call.
  "given-to-jsx.jsx": `import { useCallback, useEffect, useMemo, useState } from "react";

export function Prop({ object }) {
  const callback = useCallback(() => {
    console.log(object.a.b);
  }, [object?.a?.b]);
  return <div onClick={callback} />;
}

export function Child({ object }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  return <div>{callback}</div>;
}

export function ChildOfAFragment({ object }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  return <>{callback}</>;
}

export function SpreadProps({ object }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  return <div {...{ onClick: callback }} />;
}

export function PropOfAComponent({ object }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  return <Inner render={callback} />;
}

export function InAMemo({ object }) {
  const element = useMemo(() => <Inner render={() => object.x.y} />, [object?.x?.y]);
  return <div>{element}</div>;
}

export function SetsState({ user }) {
  const [age, setAge] = useState(0);
  const onClick = useCallback(() => {
    setAge(user.profile.age);
  }, [user?.profile?.age]);
  return <button onClick={onClick}>{age}</button>;
}

export function TwoProps({ object }) {
  const first = useCallback(() => object.a.b, [object?.a?.b]);
  const second = useCallback(() => object.c.d, [object?.c?.d]);
  return <div onClick={first} onKeyDown={second} />;
}

export function AlsoCalled({ object }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  const value = callback();
  return <div onClick={callback}>{value}</div>;
}

export function AlsoGivenToAHook({ object }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  useEffect(callback, [callback]);
  return <div onClick={callback} />;
}

export function ListedAsItIsRead({ object }) {
  const callback = useCallback(() => {
    console.log(object.a.b);
  }, [object.a.b]);
  return <div onClick={callback} />;
}

export function ListedWhole({ object, condition }) {
  const dependency = condition ? object.a.b : null;
  const callback = useCallback(() => {
    console.log(object.a.b, dependency);
  }, [object, dependency]);
  return <div onClick={callback} />;
}
`,
  // From `useCalled` on, the callback is called or given to a hook outside of a branch, or is what the hook returns.
  "calls-in-branches.jsx": `import { useCallback, useEffect } from "react";

export function useInAnIf({ object, condition }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  if (condition) {
    callback();
  }
  return [callback];
}

export function useInAnElse({ object, condition }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  let result = null;
  if (condition) {
    result = 1;
  } else {
    result = callback();
  }
  return [callback, result];
}

export function useInATernary({ object, condition }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  const result = condition ? callback() : null;
  return [callback, result];
}

export function useAfterAnd({ object, condition }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  const result = condition && callback();
  return [callback, result];
}

export function useAfterNullish({ object, fallback }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  const result = fallback ?? callback();
  return [callback, result];
}

export function useInALoop({ object, items }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  for (const item of items) {
    callback(item);
  }
  return [callback];
}

export function useInAWhileLoop({ object, count }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  let index = 0;
  while (index < count) {
    callback(index);
    index += 1;
  }
  return [callback];
}

export function useInASwitch({ object, kind }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  switch (kind) {
    case "a":
      callback();
      break;
    default:
      break;
  }
  return [callback];
}

export function useInATry({ object }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  let result = null;
  try {
    result = callback();
  } catch {
    result = null;
  }
  return [callback, result];
}

export function useAfterAReturn({ object, condition }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  if (condition) {
    return null;
  }
  callback();
  return [callback];
}

export function useGivenToAHookInAnIf({ object, condition }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  if (condition) {
    useEffect(callback, [callback]);
  }
  return [callback];
}

export function useGivenToAHookAfterAReturn({ object, condition }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  if (condition) {
    return null;
  }
  useEffect(callback, [callback]);
  return [callback];
}

export function useCalledInACallbackInAnIf({ object, condition }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  const outer = () => callback();
  if (condition) {
    outer();
  }
  return [callback];
}

export function useCalledInBothBranches({ object, condition }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  let result = null;
  if (condition) {
    result = callback();
  } else {
    result = callback();
  }
  return [callback, result];
}

export function useCalled({ object }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  callback();
  return [callback];
}

export function useCalledBeforeAnIf({ object, condition }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  const result = callback();
  if (condition) {
    callback();
  }
  return [callback, result];
}

export function useGivenToAHook({ object }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  useEffect(callback, [callback]);
  return [callback];
}

export function useReturned({ object, condition }) {
  const callback = useCallback(() => object.a.b, [object?.a?.b]);
  if (condition) {
    callback();
  }
  return callback;
}
`,
};

const ownNameOfTheComponent = `import { memo, useRef } from "react";

export default memo(function Tree({ items }) {
  const ref = useRef(0);
  const bad = ref.current;
  return <div>{bad}{items.map(item => <Tree key={item.id} items={item.items} />)}<Tree items={[]} /></div>;
});
`;

const updatesInATest = `let count = 0;

test("counts", () => {
  let renders = 0;
  function Component() {
    renders++;
    count++;
    return <div />;
  }
  render(<Component />);
});
`;

/** `foo` calls `bar` before its declaration. A pass after the validations throws a Todo for it. */
const throwsLate = `  function foo() {
    return bar();
  }
  function bar() {
    return 42;
  }`;

/**
 * What a pass throws replaces what the validations recorded. oxlint only runs the passes after the validations with
 * react/todo or react/invariant enabled, or for a function with `useMemo` or `useCallback` in its own body.
 */
const latePassFiles: Files = {
  "no-memo.jsx": `import { useRef } from "react";
export function Component() {
  const ref = useRef(null);
  const value = ref.current;
${throwsLate}
  return <Stringify fn1={foo} fn2={bar} value={value} />;
}
`,
  "own-memo.jsx": `import { useMemo, useRef } from "react";
export function Component(props) {
  const ref = useRef(null);
  const value = ref.current;
  const memoized = useMemo(() => props.a, [props.a]);
${throwsLate}
  return <Stringify fn1={foo} fn2={bar} value={value} memoized={memoized} />;
}
`,
  "own-callback.jsx": `import { useCallback, useRef } from "react";
export function Component(props) {
  const ref = useRef(null);
  const value = ref.current;
  const callback = useCallback(() => props.a, [props.a]);
${throwsLate}
  return <Stringify fn1={foo} fn2={bar} value={value} callback={callback} />;
}
`,
  // The `useMemo` isn't in the component's own body.
  "memo-in-a-callback.jsx": `import { useMemo, useRef } from "react";
export function Component(props) {
  const ref = useRef(null);
  const value = ref.current;
  const callback = () => {
    const memoized = useMemo(() => props.a, [props.a]);
    return memoized;
  };
${throwsLate}
  return <Stringify fn1={foo} fn2={bar} value={value} callback={callback} />;
}
`,
  "missing-memo-dependency.jsx": `import { useMemo } from "react";
export function Component(props) {
  const memoized = useMemo(() => props.a, []);
${throwsLate}
  return <Stringify fn1={foo} fn2={bar} memoized={memoized} />;
}
`,
  // The dependencies of an effect are still checked.
  "effect.jsx": `import { useEffect, useRef } from "react";
export function Component(props) {
  const ref = useRef(null);
  const value = ref.current;
  useEffect(() => {
    console.log(props.a);
  }, []);
${throwsLate}
  return <Stringify fn1={foo} fn2={bar} value={value} />;
}
`,
  "effect-alone.jsx": `import { useEffect } from "react";
export function Component(props) {
  useEffect(() => {
    console.log(props.a);
  }, []);
${throwsLate}
  return <Stringify fn1={foo} fn2={bar} />;
}
`,
  // react/static-components is reported apart from what's recorded, so a Todo doesn't replace it.
  "static-components.jsx": `export function Component() {
  function Inner() {
    return <div />;
  }
${throwsLate}
  return <Inner fn1={foo} fn2={bar} />;
}
`,
  "static-components-with-memo.jsx": `import { useMemo } from "react";
export function Component(props) {
  function Inner() {
    return <div />;
  }
  const memoized = useMemo(() => props.a, []);
${throwsLate}
  return <Inner fn1={foo} fn2={bar} memoized={memoized} />;
}
`,
  // An Invariant from a pass after the validations, in a function without memoization, a ref or a hoisted function.
  "invariant.jsx": `export const Component = () => {
  const raw = useValue();
  return (() => {
    try {
      return check(raw) ? raw : null;
    } catch {
      return null;
    }
  })();
};
`,
};

const latePasses: Files = { ".oxlintrc.json": rc([]) };
for (const [directory, rules] of [
  ["all", RULE_NAMES],
  ["neither", RULE_NAMES.filter(rule => rule !== "react/todo" && rule !== "react/invariant")],
  ["refs", ["react/refs"]],
  ["refs-and-invariant", ["react/refs", "react/invariant"]],
] as const) {
  latePasses[`${directory}/.oxlintrc.json`] = rc(rules);
  for (const [name, text] of Object.entries(latePassFiles)) latePasses[`${directory}/${name}`] = text;
}

/** The small input directories, keyed by test name. */
export const small: Record<string, Files> = {
  comments,
  "not React": {
    ".oxlintrc.json": rc(),
    // Nothing here creates JSX or calls a hook, and nothing is named like a component or a hook.
    "plain.js": notReact(""),
    "class.js": "export class Component {\n  render() {\n    this.props.a = Date.now();\n    return null;\n  }\n}\n",
    // The same function, opted in with 'use memo'. Nothing at the top level is a component or a hook, so the file isn't
    // compiled.
    "asked-for.js": notReact("\n  'use memo';"),
    // Beside a hook, it is.
    "asked-for-beside-a-hook.js": `${notReact("\n  'use memo';")}\nexport function useThing() {\n  return useState(0);\n}\n`,
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
    // Nothing at the top level of this one is a component or a hook, so it isn't compiled.
    "own-name-of-the-component.jsx": ownNameOfTheComponent,
    "own-name-beside-a-component.jsx": `${ownNameOfTheComponent}\nexport function Other() {\n  return null;\n}\n`,
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
    // Nor is this one.
    "update.jsx": updatesInATest,
    "update-beside-a-component.jsx": `${updatesInATest}\nexport function Other() {\n  return null;\n}\n`,
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
  "nested components": nestedComponents,
  "ref arguments": refArguments,
  gate,
  reanimated,
  "all caps": allCaps,
  "allowed calls": allowedCalls,
  "async components": asyncComponents,
  "update expressions": updateExpressions,
  "callback locals": callbackLocals,
  "logical assignment": logicalAssignment,
  "new Date": newDate,
  "hoisted functions": hoistedFunctions,
  "ref receiver": refReceiver,
  "catch phis": catchPhis,
  suppressions,
  "ambient declarations": ambientDeclarations,
  "try finally": tryFinally,
  "unreachable catch": unreachableCatch,
  "lone surrogates": loneSurrogates,
  "folded constants": foldedConstants,
  "member chains": memberChains,
  "ref types": refTypes,
  "ref hints": refHints,
  "captured functions": capturedFunctions,
  "optional dependencies": optionalDependencies,
  "late passes": latePasses,
  "using declarations": usingDeclarations,
  "operator operands": operatorOperands,
  "merged memo scopes": mergedMemoScopes,
  "control reactivity": controlReactivity,
  "jsx tags": jsxTags,
  "fixture modules": fixtureModules,
  "assumed calls": assumedCalls,
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
