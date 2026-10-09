// The inputs of ../../react-compiler.test.ts, which expected.ts gives to oxlint and to ESLint: directories of files, each linted in
// one run without arguments but `-f json`. Those that are not written for this test are in expected.json.

import { ESLINT_ONLY, RULE_NAMES, RULES } from "./shared.ts";

/** An `.oxlintrc.json` with nothing on but `rules`. */
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

/** The small directories, by the name of the test. */
export const small: Record<string, Files> = {
  comments,
  "not React": {
    ".oxlintrc.json": rc(),
    // Nothing here makes JSX or calls a hook, and no name is a component's or a hook's.
    "plain.js": notReact(""),
    "class.js": "export class Component {\n  render() {\n    this.props.a = Date.now();\n    return null;\n  }\n}\n",
    // The same function, asked for.
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
  node_modules: {
    ".oxlintrc.json": rc(),
    "a.jsx": impure,
    "node_modules/package/a.jsx": impure,
    "vendor/node_modules/package/a.jsx": impure,
    // The name only has to be somewhere in the path.
    "src/not_node_modules/a.jsx": impure,
  },
};

type RawDiagnostic = { filename?: string; url?: string; [key: string]: unknown };

/** The same value with the keys of every object in order. */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
  return Object.fromEntries(entries.map(([key, item]) => [key, ordered(item)]));
}

/**
 * The diagnostics of a report of `-f json` for each file, as they are but for the name of the file and the address of the rule's
 * page, in an order that does not depend on the tool's.
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

/** The rules of the plugin that report what the compiler finds. */
export const ESLINT_RULES = [
  ...RULES.map(([rule]) => `react-hooks/${rule}`),
  ...ESLINT_ONLY.map(([rule]) => `react-hooks/${rule}`),
  "react-hooks/component-hook-factories",
];

/** An `eslint.config.js`. By their names: the rules of the plugin and the parser of typescript-eslint are built in. */
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
  // The plugin parses a `.ts` or `.tsx` file with Babel, which knows the name of the file and where in the text a node is.
  "typescript.tsx": extraDependency("{ a, b }: { a: number; b: number }"),
  // All others with Hermes, which knows neither: no line with the name, and no suggestion that needs the place of the list.
  "javascript.jsx": extraDependency("{ a, b }"),
  // A place of more than ten lines.
  "long.jsx": `function Component(props) {
  let value = 0;
  try {
${["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(name => `    value += props.${name};\n`).join("")}  } finally {
    props.done();
  }
  return <div>{value}</div>;
}
`,
  "disabled.jsx": readsRef("// eslint-disable-next-line react-hooks/refs"),
  "flow-hook.jsx": readsRef("// $FlowFixMe[react-rule-hook]"),
  "flow-ref.jsx": readsRef("// $FlowFixMe[react-rule-unsafe-ref]"),
  "flow-other.jsx": readsRef("// $FlowFixMe[other]"),
  // typescript-eslint parses it. Babel, as the plugin calls it, does not.
  "decorator.tsx": `@sealed\nclass Store {}\n\n${readsRef("")}`,
  // No function has the name of a component or a hook, so the plugin does not look further.
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
 * The results of ESLint's `-f json` for each file that has messages, suppressed ones too. The paths are relative to one of
 * `directories`, which is `<dir>` in the messages.
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

/** Of each message the rule, the place and the first line. */
export const briefly = (files: ReturnType<typeof byEslintFile>) =>
  Object.fromEntries(
    Object.entries(files).map(([path, { messages }]) => [
      path,
      messages.map(
        it => `${it.ruleId} ${it.line}:${it.column}-${it.endLine}:${it.endColumn} ${it.message.split("\n")[0]}`,
      ),
    ]),
  );
