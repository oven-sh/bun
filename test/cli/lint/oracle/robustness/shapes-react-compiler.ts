// The cases of cases.ts for the rules that report what the React Compiler finds: react/refs, react/immutability, react/hooks and the
// other 19. A component has n of one thing in `wideShapes` and one thing n deep in `deepShapes`.
import { RULE_NAMES } from "../react-compiler/shared";
import type { Case } from "./cases";

const seq = (n: number, f: (i: number) => string, sep = "") => Array.from({ length: n }, (_, i) => f(i)).join(sep);
/** `"".repeat` is slow in a debug build of JavaScriptCore. */
const rep = (text: string, n: number) => Buffer.alloc(Buffer.byteLength(text) * n, text).toString();

const component = (body: string, returns = "<div />") =>
  `function Component(props) {\n  const [s, setS] = useState(0);\n${body}\n  return ${returns};\n}\n`;
const components = (n: number) => seq(n, i => `function C${i}(props) { useState(0); return <a />; }\n`);

const wideShapes: Record<string, (n: number) => string> = {
  "rc-binary.jsx": n => component(`const x = ${rep("s + ", n)}s;`),
  "rc-dots.jsx": n => component(`const x = props${rep(".a", n)};`),
  "rc-arguments-of-a-call.jsx": n => component(`const x = f(${rep("s,", n)});`),
  "rc-pattern-defaults.jsx": n => component(`const {${seq(n, i => `a${i} = s`, ",")}} = props;`),
  "rc-for-of.jsx": n => component(seq(n, i => `  for (const a${i} of props.l) { s; }\n`)),
  "rc-trys.jsx": n => component(rep("  try { s; } catch (e) { s; }\n", n)),
  "rc-one-phi.jsx": n => component("  let v = 0;\n" + seq(n, i => `  if (props.a${i}) { v = ${i}; }\n`) + "  v;"),
  "rc-same-name-in-blocks.jsx": n => component(rep("  { const a = s; a; }\n", n)),
  "rc-memos.jsx": n => component(seq(n, i => `  const m${i} = useMemo(() => s + ${i}, [s]);\n`)),
  "rc-closures.jsx": n => component(seq(n, i => `  const f${i} = () => s + ${i};\n`)),
  "rc-new-dates.jsx": n => component(rep("  new Date();\n", n)),
  "rc-suppressions-and-components.jsx": n =>
    rep("/* eslint-disable react-hooks/rules-of-hooks */\n", n) + components(n),
};

const deepShapes: Record<string, (n: number) => string> = {
  "rc-ifs.jsx": n => component(`${rep("if (props.a) {", n)}s;${rep("}", n)}`),
  "rc-jsx.jsx": n => component("", `${rep("<a>", n)}{s}${rep("</a>", n)}`),
};

const rules = Object.fromEntries(RULE_NAMES.map(rule => [rule, "error"]));

/** It is compiled, in a small part of a second. */
const compiled = (name: string, text: () => string, reports: Record<string, number> = {}): Case => ({
  name: `a component with ${name}`,
  file: "a.jsx",
  text,
  rules,
  reports,
  exitCode: Object.keys(reports).length > 0 ? 1 : 0,
});

const heavy = (it: Case): Case => ({ ...it, isHeavy: true });

/** It would overflow the stack. How deep is too deep depends on the stack that is left, but this is in every build. */
const tooDeep = (name: string, text: () => string): Case => ({
  name: `a component with ${name} is not compiled`,
  file: "a.jsx",
  text,
  rules,
  args: ["-f", "json"],
  matches:
    /^\{ "diagnostics": \[\{"message": "Support functions of this size","code": "react\(todo\)",.*"help": "The function body is nested too deeply",.*\}\],$/m,
  exitCode: 1,
});

/** Whether it is compiled depends on the stack that is left. */
const deepOrNot = (name: string, text: () => string): Case => ({
  name: `a component with ${name} ends by no signal`,
  file: "a.jsx",
  text,
  rules,
  exitCode: [0, 1],
});

export const cases: Case[] = [
  compiled("a call that has 48 arguments", () => wideShapes["rc-arguments-of-a-call.jsx"](48)),
  heavy(compiled("a variable that 250 ifs assign", () => wideShapes["rc-one-phi.jsx"](250))),
  heavy(compiled("150 for-of loops", () => wideShapes["rc-for-of.jsx"](150))),
  heavy(compiled("a pattern that has 150 defaults", () => wideShapes["rc-pattern-defaults.jsx"](150))),
  heavy(compiled("250 blocks that declare the same name", () => wideShapes["rc-same-name-in-blocks.jsx"](250))),
  heavy(compiled("250 try statements", () => wideShapes["rc-trys.jsx"](250))),
  heavy(compiled("300 new Date()", () => wideShapes["rc-new-dates.jsx"](300), { "react/purity": 300 })),
  compiled("250 closures", () => wideShapes["rc-closures.jsx"](250)),
  compiled("250 useMemo", () => wideShapes["rc-memos.jsx"](250)),
  // A debug build has frames ten times as large, and refuses what is a tenth as deep.
  compiled("ifs 8 deep", () => deepShapes["rc-ifs.jsx"](8)),
  heavy(compiled("ifs 60 deep", () => deepShapes["rc-ifs.jsx"](60))),
  deepOrNot("ifs 1,000 deep", () => deepShapes["rc-ifs.jsx"](1_000)),
  compiled("JSX 15 deep", () => deepShapes["rc-jsx.jsx"](15)),
  heavy(compiled("JSX 100 deep", () => deepShapes["rc-jsx.jsx"](100))),
  deepOrNot("JSX 1,000 deep", () => deepShapes["rc-jsx.jsx"](1_000)),
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
    // 160,000.
    name: "400 comments that disable the rules of hooks and 400 components",
    isHeavy: true,
    file: "a.jsx",
    text: () => wideShapes["rc-suppressions-and-components.jsx"](400),
    rules,
    matches: /^a\.jsx:400:1: React rule suppression prevents optimization /m,
    exitCode: 1,
  },
];
