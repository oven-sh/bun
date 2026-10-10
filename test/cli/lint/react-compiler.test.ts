// The rules that report what the React Compiler finds: the 22 `react/*` of oxlint, and the 27 `react-hooks/*` of
// eslint-plugin-react-hooks. What oxlint and ESLint report for the same inputs is in oracle/react-compiler/expected.json;
// expected.ts there writes it.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, normalizeBunSnapshot, tempDir } from "harness";
import { realpathSync } from "node:fs";
import { endChildren, spawn } from "../children";
import expected from "./oracle/react-compiler/expected.json";
import {
  briefly,
  byEslintFile,
  byFile,
  eslintConfig,
  eslintSmall,
  type Files,
  rc,
  small,
  twoLabels,
} from "./oracle/react-compiler/inputs";

afterAll(endChildren);

// Disable AI agent and CI detection regardless of the environment the tests run in.
const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  GITHUB_WORKSPACE: undefined,
  NO_COLOR: undefined,
  FORCE_COLOR: undefined,
};

async function lint(files: Files, args: string[], more: Record<string, string> = {}) {
  using dir = tempDir("bun-lint-react-compiler", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...args],
    env: { ...env, ...more },
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    raw: stdout,
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr,
    exitCode,
    directories: [realpathSync(String(dir)), String(dir)],
  };
}

/** What expected.json has for a directory. The order in a file is left out: oxlint's is by rule, ours is by position. */
async function report(files: Files) {
  const { raw, stderr, exitCode } = await lint(files, ["-f", "json"]);
  if (!raw.startsWith("{")) throw new Error(`No report (exit ${exitCode}): ${stderr}`);
  const { diagnostics, number_of_files } = JSON.parse(raw);
  return { diagnostics: byFile({ diagnostics }), files: number_of_files, exit: exitCode };
}

const rulesIn = (diagnostics: Record<string, unknown[]>) =>
  [...new Set(Object.values(diagnostics).flatMap(found => found.map(it => (it as { code: string }).code)))].sort();

const slow = isDebug || isASAN ? 120_000 : undefined;

describe.concurrent(`bun lint: the rules of the React Compiler report what oxlint ${expected.oxlint} reports`, () => {
  test(
    "for oxlint's own test cases",
    async () => {
      const { diagnostics, files, exit } = await report({ ".oxlintrc.json": rc(), ...expected.cases });
      expect(diagnostics).toEqual(expected.reports.cases.diagnostics);
      // A case that is not valid has a diagnostic of its rule, a valid one has none.
      for (const path of Object.keys(expected.cases)) {
        const code = `react(${path.slice(0, path.indexOf("/"))})`;
        const found = (diagnostics[path] ?? []).some(it => (it as { code: string }).code === code);
        expect([path, found]).toEqual([path, path.includes(".invalid.")]);
      }
      expect(files).toBe(expected.reports.cases.files);
      expect(exit).toBe(expected.reports.cases.exit);
    },
    slow,
  );

  test(
    "for fixtures of the compiler",
    async () => {
      const { diagnostics, files, exit } = await report({ ".oxlintrc.json": rc(), ...expected.fixtures });
      expect(diagnostics).toEqual(expected.reports.fixtures.diagnostics);
      expect(rulesIn(diagnostics)).toEqual([
        "react(error-boundaries)",
        "react(exhaustive-effect-dependencies)",
        "react(globals)",
        "react(hooks)",
        "react(immutability)",
        "react(invariant)",
        "react(memo-dependencies)",
        "react(no-deriving-state-in-effects)",
        "react(preserve-manual-memoization)",
        "react(purity)",
        "react(refs)",
        "react(rule-suppression)",
        "react(set-state-in-effect)",
        "react(set-state-in-render)",
        "react(static-components)",
        "react(todo)",
        "react(unsupported-syntax)",
        "react(use-memo)",
        "react(void-use-memo)",
      ]);
      expect(files).toBe(expected.reports.fixtures.files);
      expect(exit).toBe(expected.reports.fixtures.exit);
    },
    slow,
  );

  test("nothing for what is neither a component nor a hook, unless 'use memo' asks for it", async () => {
    const { diagnostics, files, exit } = await report(small["not React"]);
    expect(diagnostics).toEqual(expected.reports["not React"].diagnostics);
    expect(Object.keys(diagnostics)).toEqual(["asked-for.js"]);
    expect(files).toBe(3);
    expect(exit).toBe(1);
  });

  test("disable comments: by any name of the plugin or none, of ESLint and of oxlint, at the first label", async () => {
    const { diagnostics, files, exit } = await report(small.comments);
    expect(diagnostics).toEqual(expected.reports.comments.diagnostics);
    // All others are silenced.
    expect(Object.keys(diagnostics)).toEqual([
      "before-the-second-label.jsx",
      "eslint/react.purity.jsx",
      "oxlint/react.purity.jsx",
      "until-enabled.jsx",
    ]);
    expect(files).toBe(expected.reports.comments.files);
    expect(exit).toBe(1);
  });

  test("react/todo on, off or alone: the other rules report the same", async () => {
    const { diagnostics, exit } = await report(small.todo);
    expect(diagnostics).toEqual(expected.reports.todo.diagnostics);
    const isTodo = (it: unknown) => (it as { code: string }).code === "react(todo)";
    expect(diagnostics["on/a.jsx"].filter(it => !isTodo(it))).toEqual(diagnostics["off/a.jsx"]);
    expect(diagnostics["on/a.jsx"].filter(isTodo)).toEqual(diagnostics["alone/a.jsx"]);
    expect(diagnostics["alone/a.jsx"]).toHaveLength(2);
    expect(exit).toBe(1);
  });

  test("what oxc's fork of the compiler takes or says otherwise", async () => {
    const { diagnostics, files, exit } = await report(small.fork);
    expect(diagnostics).toEqual(expected.reports.fork.diagnostics);
    // The others are compiled.
    expect(Object.keys(diagnostics)).toEqual([
      "arguments.jsx",
      "catch.jsx",
      "clock.jsx",
      "default.jsx",
      "import.jsx",
      "ref-in-memo.jsx",
      "update.jsx",
      "virtual.jsx",
    ]);
    expect(files).toBe(expected.reports.fork.files);
    expect(exit).toBe(1);
  });

  test("a type cast has a place of its own, and hides what it is a cast of", async () => {
    const { diagnostics, exit } = await report(small.casts);
    expect(diagnostics).toEqual(expected.reports.casts.diagnostics);
    expect(diagnostics["casts.tsx"]).toHaveLength(8);
    expect(exit).toBe(1);
  });

  // oxlint and eslint-plugin-react-hooks take all the memory there is for functions like these, so the words are ours.
  test(
    "a small function whose types or refs are made of each other takes no time to speak of",
    async () => {
      const { diagnostics, exit } = await report({
        ".oxlintrc.json": rc(),
        "types.jsx": `function Component(props) { let a, b, c, d, e; l1: for (let i2 = 0; i2 < 0; i2++) {  try {  do { try { switch (props.x) { case 0: { }  case 1: { [a = 3, b = b] = props.l;  }  case 2: { } default: { } case 3: { b = a; }  } } catch (err) { }  } while (props.x); } catch (err) { } } return <div>{a}{b}{c}{d}{e}</div>; }`,
        "cycle.jsx": `function Component(props) { let a, b, c, d, e; while (props.x) { switch (c?.p) { case 0: { while (props.y) { switch (f0) { default: {   try { } catch (err) { } for (const x3 of 0) {  e = ((props.x && (props.x ?? d)) || { });  } ({p: a = e, q: c} = props.o); } case 0: { if (fprops.x) {  d = (props.y && (fprops.x ? a : f0)); } }  case 1: { }  }  while ((f((props.x ? null : a)) < props.x)) { if ((0 === 0)) { ({p: e = b, q: a} = props.o); d = d;  }  } } } case 1: { } default: { } }   }    a = { };  return <div>{a}{b}{c}{d}{e}</div>; }`,
        "refs.jsx": `function Component(props) { let {a = 1, b = a, c = b, d = c, e = d} = props; { } l2: { for (let i3 = 0; i3 < (c ?? a); i3++) { try { { while ((() => (f(b) - null))) { c += f0;  } } } catch (err) {  for (const x4 of props.x) {  const g5 = () => { f(a, d); c = d; }; f(g5); switch (0) { case 0: { } default: {  c = {k: d}; } case 1: { } case 2: { }  } } try { } catch (err) { } if (props.x) { for (const k12 in props.x) {  c = (() => c); }  } }   }  }  b = [props.y, c];  d++;  c -= d; return <div>{a}{b}{c}{d}{e}</div>; }`,
      });
      const said = (path: string) =>
        (diagnostics[path] as { code: string; message: string; help: string }[]).map(it => [
          it.code,
          it.message,
          it.help,
        ]);
      // Nothing is wrong in the two whose types are made of each other.
      expect(Object.keys(diagnostics)).toEqual(["refs.jsx"]);
      expect(said("refs.jsx")).toEqual([
        ["react(todo)", "Support functions of this size", "Its refs are too complex to follow"],
      ]);
      expect(exit).toBe(1);
    },
    slow,
  );

  test("a try in which nothing but a read that nobody uses can throw does not end the process", async () => {
    const { files, exit } = await report({
      ".oxlintrc.json": rc(),
      "a.jsx": `export default function Component(props) {
        let a = props.a;
        try {
          props.d.m;
        } catch (err) {
          a = props.x;
        }
        return <div>{a}</div>;
      }`,
    });
    expect(files).toBe(1);
    expect([0, 1]).toContain(exit);
  });

  test("nothing for a path that has node_modules in it", async () => {
    const { diagnostics, files, exit } = await report(small.node_modules);
    expect(diagnostics).toEqual(expected.reports.node_modules.diagnostics);
    expect(Object.keys(diagnostics)).toEqual(["a.jsx"]);
    // They are linted, but not compiled.
    expect(files).toBe(4);
    expect(exit).toBe(1);
  });
});

describe.concurrent("bun lint: all labels, the help and the note of a diagnostic", () => {
  const files = { ".oxlintrc.json": rc(["react/set-state-in-effect"]), "a.jsx": twoLabels };

  test("pretty", async () => {
    const { stdout, exitCode } = await lint(files, ["-f", "pretty"]);
    expect(stdout).toMatchInlineSnapshot(`
      "2 |   const [state, setState] = useState(0);
      3 |   useEffect(() => {
      4 |     setState(1);
              ^
      error: Calling setState synchronously within an effect can trigger cascading renders  react/set-state-in-effect
          at a.jsx:4:5

      note: Avoid calling setState() directly within an effect
      note: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
      note: React Compiler skipped optimizing this component or hook. Additional guidance: https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect
      3 |   useEffect(() => {
            ^
      note: This is the containing effect
         at a.jsx:3:3

      Linted 1 file"
    `);
    expect(exitCode).toBe(1);
  });

  test("agent, which is the default for an agent, is oxlint's: a line, with the help", async () => {
    const [named, detected] = await Promise.all([lint(files, ["-f", "agent"]), lint(files, [], { AGENT: "1" })]);
    expect(named.stdout).toMatchInlineSnapshot(
      `"a.jsx:4:5: error react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system."`,
    );
    expect(detected.stdout).toBe(named.stdout);
    expect({ named: named.exitCode, detected: detected.exitCode }).toEqual({ named: 1, detected: 1 });
  });
});

describe.concurrent(
  `bun lint: the rules of the React Compiler report what eslint-plugin-react-hooks ${expected.eslint.plugin} reports`,
  () => {
    /** What ESLint's `-f json` has for each file that has messages. */
    async function messages(files: Files) {
      const { raw, stderr, exitCode, directories } = await lint({ "eslint.config.js": eslintConfig, ...files }, [
        "-f",
        "json",
      ]);
      if (!raw.startsWith("[")) throw new Error(`No report (exit ${exitCode}): ${stderr}`);
      return { files: byEslintFile(JSON.parse(raw), directories), exitCode };
    }
    const linted = (files: Files) =>
      Object.fromEntries(
        Object.entries(files).filter(
          ([name]) => !expected.eslint.without.includes(name) && !name.includes("node_modules/"),
        ),
      );

    test(
      "for oxlint's test cases: the rule, the place, the first line",
      async () => {
        const { files, exitCode } = await messages(linted(expected.cases));
        expect(briefly(files)).toEqual(expected.eslint.cases);
        expect(exitCode).toBe(1);
      },
      slow,
    );

    test(
      "for fixtures of the compiler: the rule, the place, the first line",
      async () => {
        const { files, exitCode } = await messages(linted(expected.fixtures));
        expect(briefly(files)).toEqual(expected.eslint.fixtures);
        expect(exitCode).toBe(1);
      },
      slow,
    );

    test("the whole message, suggestions, comments, and files that the plugin does not compile", async () => {
      const { files, exitCode } = await messages(eslintSmall);
      expect(files).toEqual(expected.eslint.small);
      // Nothing for `$FlowFixMe[react-rule-hook]` and `[react-rule-unsafe-ref]`, for a file with a decorator, and for a component
      // without a name.
      expect(briefly(files)).toEqual({
        "casts.tsx": [
          "react-hooks/static-components 7:8-7:13 Error: Cannot create components during render",
          "react-hooks/immutability 13:4-13:16 Error: This value cannot be modified",
          "react-hooks/refs 19:22-19:40 Error: Cannot access refs during render",
          "react-hooks/refs 20:19-20:30 Error: Cannot access refs during render",
          "react-hooks/memo-dependencies 25:39-25:46 Error: Found missing memoization dependencies",
          "react-hooks/use-memo 25:50-25:66 Error: Expected the dependency list to be an array of simple expressions (e.g. `x`, `x.y.z`, `x?.y?.z`)",
          "react-hooks/immutability 30:4-30:33 Error: This value cannot be modified",
          "react-hooks/immutability 35:3-35:14 Error: This value cannot be modified",
        ],
        "disabled.jsx": [],
        "flow-other.jsx": ["react-hooks/refs 4:17-4:28 Error: Cannot access refs during render"],
        "javascript.jsx": ["react-hooks/memo-dependencies 2:40-2:41 Error: Found extra memoization dependencies"],
        "long.jsx": [
          "react-hooks/todo 3:3-15:4 Todo: (BuildHIR::lowerStatement) Handle TryStatement without a catch clause",
        ],
        "typescript.tsx": ["react-hooks/memo-dependencies 2:40-2:41 Error: Found extra memoization dependencies"],
      });
      expect(files["disabled.jsx"].suppressed.map(it => it.ruleId)).toEqual(["react-hooks/refs"]);
      expect(files["typescript.tsx"].messages[0].suggestions).toEqual([
        { desc: "Update dependencies", range: [92, 98], text: "[a]" },
      ]);
      expect(files["typescript.tsx"].messages[0].message).toMatchInlineSnapshot(`
        "Error: Found extra memoization dependencies

        Extra dependencies can cause a value to update more often than it should, resulting in performance problems such as excessive renders or effects firing too often.

        <dir>/typescript.tsx:2:40
          1 | function Component({ a, b }: { a: number; b: number }) {
        > 2 |   const value = useMemo(() => [a], [a, b]);
            |                                        ^ Unnecessary dependency \`b\`
          3 |   return <div>{value}</div>;
          4 | }
          5 |

        Inferred dependencies: \`[a]\`"
      `);
      expect(files["javascript.jsx"].messages[0].suggestions).toEqual([]);
      expect(files["javascript.jsx"].messages[0].message).toMatchInlineSnapshot(`
        "Error: Found extra memoization dependencies

        Extra dependencies can cause a value to update more often than it should, resulting in performance problems such as excessive renders or effects firing too often.

          1 | function Component({ a, b }) {
        > 2 |   const value = useMemo(() => [a], [a, b]);
            |                                        ^ Unnecessary dependency \`b\`
          3 |   return <div>{value}</div>;
          4 | }
          5 |"
      `);
      // The middle of a place of more than ten lines is left out. A diagnostic of the older kind ends in two line breaks.
      expect(files["long.jsx"].messages[0].message.split("\n")).toEqual([
        "Todo: (BuildHIR::lowerStatement) Handle TryStatement without a catch clause",
        "",
        "   1 | function Component(props) {",
        "   2 |   let value = 0;",
        ">  3 |   try {",
        "     |   ^^^^^",
        ">  4 |     value += props.a;",
        "     | ^^^^^^^^^^^^^^^^^^^^^",
        ">  5 |     value += props.b;",
        "     …",
        "     | ^^^^^^^^^^^^^^^^^^^^^",
        "> 14 |     props.done();",
        "     | ^^^^^^^^^^^^^^^^^^^^^",
        "> 15 |   }",
        "     | ^^^^ (BuildHIR::lowerStatement) Handle TryStatement without a catch clause",
        "  16 |   return <div>{value}</div>;",
        "  17 | }",
        "  18 |",
        "",
        "",
      ]);
      expect(exitCode).toBe(1);
    });
  },
);
