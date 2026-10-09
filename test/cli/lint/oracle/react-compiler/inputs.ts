// The inputs of ../../react-compiler.test.ts, which expected.ts gives to oxlint: directories of files, each linted in one run
// without arguments but `-f json`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RULE_NAMES } from "./shared.ts";

/** An `.oxlintrc.json` with nothing on but `rules`. */
export const rc = (rules: readonly string[] = RULE_NAMES) =>
  JSON.stringify({
    plugins: ["react"],
    categories: { correctness: "off" },
    rules: Object.fromEntries(rules.map(rule => [rule, "error"])),
  });

/** The compiler's own fixtures, two to four for each rule that reports anything in them. */
export const FIXTURES = [
  "allow-global-reassignment-in-effect.js",
  "context-variable-as-jsx-element-tag.js",
  "effect-derived-computations/derived-state-from-prop-setter-call-outside-effect-no-error.js",
  "effect-derived-computations/effect-with-global-function-call-no-error.js",
  "error.assign-global-in-component-tag-function.js",
  "error.bug-invariant-couldnt-find-binding-for-decl.js",
  "error.bug-invariant-expected-consistent-destructuring.js",
  "error.function-expression-references-variable-its-assigned-to.js",
  "error.hoist-optional-member-expression-with-conditional.js",
  "error.invalid-array-push-frozen.js",
  "error.invalid-disallow-mutating-ref-in-render.js",
  "error.invalid-eval-unsupported.js",
  "error.invalid-impure-functions-in-render.js",
  "error.invalid-optional-member-expression-as-memo-dep-non-optional-in-body.js",
  "error.invalid-pass-hook-as-prop.js",
  "error.invalid-props-mutation-in-effect-indirect.js",
  "error.invalid-reassign-variable-in-usememo.js",
  "error.invalid-ref-value-as-props.js",
  "error.invalid-setState-in-useMemo.js",
  "error.invalid-sketchy-code-use-forget.js",
  "error.invalid-unconditional-set-state-in-render.js",
  "error.mutate-global-increment-op-invalid-react.js",
  "error.todo-invalid-jsx-in-try-with-finally.js",
  "error.useMemo-non-literal-depslist.ts",
  "exhaustive-deps/error.invalid-dep-on-ref-current-value.js",
  "exhaustive-deps/error.invalid-exhaustive-effect-deps.js",
  "fbt/error.todo-locally-require-fbt.js",
  "invalid-jsx-in-catch-in-outer-try-with-catch.js",
  "invalid-jsx-in-try-with-catch.js",
  "invalid-set-state-in-effect-verbose-non-local-derived.js",
  "invalid-unused-usememo.js",
  "preserve-memo-validation/error.useMemo-property-call-dep.ts",
  "rules-of-hooks/error.invalid-conditionally-call-prop-named-like-hook.js",
  "rules-of-hooks/error.invalid-hook-as-prop.js",
  "rules-of-hooks/error.invalid-hook-for.js",
  "should-bailout-without-compilation-infer-mode.js",
  "static-components/invalid-dynamically-constructed-component-method-call.js",
  "timers.js",
  "use-no-forget-with-eslint-suppression.js",
  "useMemo-if-else-multiple-return.js",
  "useMemo-named-function.ts",
];

export const fixturesDirectory = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "bundler",
  "transpiler",
  "react-compiler-fixtures",
);

export type Files = Record<string, string>;

export function fixtures(): Files {
  const files: Files = { ".oxlintrc.json": rc() };
  for (const path of FIXTURES) files[path] = readFileSync(join(fixturesDirectory, path), "utf8");
  return files;
}

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
