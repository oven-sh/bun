// The 22 rules `react/*` that report what the React Compiler finds, as oxlint has them. What oxlint reports for the same inputs
// is in oracle/react-compiler/expected.json; expected.ts there writes it.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, normalizeBunSnapshot, tempDir } from "harness";
import expected from "./oracle/react-compiler/expected.json";
import { byFile, type Files, rc, small, twoLabels } from "./oracle/react-compiler/inputs";

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
  await using proc = Bun.spawn({
    cmd: [bunExe(), "lint", ...args],
    env: { ...env, ...more },
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { raw: stdout, stdout: normalizeBunSnapshot(stdout, String(dir)), stderr, exitCode };
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
         at a.jsx:3:3"
    `);
    expect(exitCode).toBe(1);
  });

  test("agent, which is the default for an agent", async () => {
    const [named, detected] = await Promise.all([lint(files, ["-f", "agent"]), lint(files, [], { AGENT: "1" })]);
    expect(named.stdout).toMatchInlineSnapshot(`
      "<error file="a.jsx" line="4" column="5" rule="react/set-state-in-effect">
      Calling setState synchronously within an effect can trigger cascading renders
      <source>
      2 |   const [state, setState] = useState(0);
      3 |   useEffect(() => {
      4 |     setState(1);
              ^^^^^^^^
      5 |   }, []);
      </source>
      <label line="4" column="5">Avoid calling setState() directly within an effect</label>
      <label line="3" column="3">This is the containing effect</label>
      <help>Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.</help>
      <note>React Compiler skipped optimizing this component or hook. Additional guidance: https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect</note>
      </error>"
    `);
    expect(detected.stdout).toBe(named.stdout);
    expect({ named: named.exitCode, detected: detected.exitCode }).toEqual({ named: 1, detected: 1 });
  });
});
