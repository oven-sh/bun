// What happens when a rule throws instead of reporting, for example because a file named in its options is missing. A rule of a
// JavaScript plugin throws for real. A native rule calls `cx.throw()`, which has to look the same.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

async function lint(files: Record<string, string>, args: string[]) {
  using dir = tempDir("bun-lint-rule-throws", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const tidy = (text: string) => text.replaceAll("\\", "/").replaceAll(String(dir).replaceAll("\\", "/"), "<dir>");
  return { stdout, stderr: tidy(stderr), exitCode, tidy };
}

const plugin = `
  const missing = () => { throw new Error("allowance file 'allow.json' is missing"); };
  class AllowanceError extends Error { name = "AllowanceError"; }
  export default {
    meta: { name: "mini" },
    rules: {
      "in-create": { create: missing },
      "in-listener": { create: () => ({ Identifier: missing }) },
      "reports-first": {
        create: context => ({
          Program: node => context.report({ node, message: "reported before the throw" }),
          Identifier: missing,
        }),
      },
      "range-error": { create: () => ({ Identifier() { throw new RangeError("Invalid count value: -1"); } }) },
      "own-class": { create: () => ({ Identifier() { throw new AllowanceError("no file"); } }) },
      "two-lines": { create: () => ({ Identifier() { throw new Error("line one\\nline two"); } }) },
      "not-an-error": { create: () => ({ Identifier() { throw "just a string"; } }) },
      ...Object.fromEntries(
        Object.entries({
          error: () => new Error("real error"),
          "type-error": () => new TypeError("real type error"),
          "empty-message": () => new Error(""),
          string: () => "just a string",
          number: () => 5,
          symbol: () => Symbol("s"),
          undefined: () => undefined,
          null: () => null,
        }).map(([name, value]) => ["create-throws-" + name, { create() { throw value(); } }]),
      ),
      fine: { create: context => ({ DebuggerStatement: node => context.report({ node, message: "fine saw a debugger" }) }) },
    },
  };
`;
const files = {
  "plugin.mjs": plugin,
  "a.js": "let a = 1;\ndebugger;\nexport default a;\n",
  "no-identifier.js": "debugger;\n",
  "disabled.js": "/* eslint-disable */\nlet a = 1;\ndebugger;\nexport default a;\n",
};
const names = ["a.js", "no-identifier.js", "disabled.js"];

type Diagnostic = { message: string; code?: string; severity: string; filename: string; labels: unknown[] };

/** Every diagnostic as `file severity code: message`, sorted, without the stack frames: those are the engine's. */
function diagnostics({ stdout, tidy }: Awaited<ReturnType<typeof lint>>) {
  return (JSON.parse(stdout).diagnostics as Diagnostic[])
    .map(it => `${it.filename} ${it.severity} ${it.code ?? "no code"}: ${tidy(it.message.replace(/\n {4}at .*/g, ""))}`)
    .sort();
}

const failed = (file: string, error: string) =>
  `${file} error no code: Error running JS plugin.\nFile path: <dir>/${file}\n${error}`;
const missing = "Error: allowance file 'allow.json' is missing";

describe.concurrent("with an oxlint config", () => {
  const oxlintrc = (rules: Record<string, unknown>, more = {}) => ({
    ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules, ...more }),
  });
  const withPlugin = (rules: Record<string, unknown>) =>
    oxlintrc({ "no-debugger": "warn", "mini/fine": "warn", ...rules }, { jsPlugins: ["./plugin.mjs"] });
  const debuggers = (...names: string[]) =>
    names.map(it => `${it} warning eslint(no-debugger): \`debugger\` statement is not allowed`);

  // All of this is what oxlint 1.87 prints.
  describe("a JavaScript rule that throws", () => {
    test.each(["warn", "error"])("in create() is an error in every file when it's set to %s", async severity => {
      const result = await lint({ ...files, ...withPlugin({ "mini/in-create": severity }) }, ["-f", "json", ...names]);
      expect(diagnostics(result)).toEqual(
        [
          ...["a.js", "disabled.js", "no-identifier.js"].map(it => failed(it, missing)),
          ...debuggers("a.js", "no-identifier.js"),
        ].sort(),
      );
      expect(result.exitCode).toBe(1);
    });

    test.each(["warn", "error"])(
      "in a listener is an error where the listener runs when it's set to %s",
      async severity => {
        const result = await lint({ ...files, ...withPlugin({ "mini/in-listener": severity }) }, [
          "-f",
          "json",
          ...names,
        ]);
        expect(diagnostics(result)).toEqual(
          [
            ...["a.js", "disabled.js"].map(it => failed(it, missing)),
            ...debuggers("a.js", "no-identifier.js"),
            "no-identifier.js warning mini(fine): fine saw a debugger",
          ].sort(),
        );
        expect(result.exitCode).toBe(1);
      },
    );

    test.each([
      ["mini/reports-first", missing],
      ["mini/range-error", "RangeError: Invalid count value: -1"],
      ["mini/own-class", "AllowanceError: no file"],
      ["mini/two-lines", "Error: line one\nline two"],
      ["mini/not-an-error", "Unknown error"],
    ])("%s", async (rule, error) => {
      const result = await lint({ ...files, ...withPlugin({ [rule]: "warn" }) }, ["-f", "json", "a.js"]);
      expect(diagnostics(result)).toEqual([failed("a.js", error), ...debuggers("a.js")]);
      expect(result.exitCode).toBe(1);
    });

    test.each([
      [["--quiet"], false],
      [["--max-warnings", "0"], true],
      [["--deny-warnings"], true],
      [["--fix"], true],
    ])("with %j", async (flags, hasWarnings) => {
      const config = withPlugin({ "mini/in-create": "warn" });
      const result = await lint({ ...files, ...config }, ["-f", "json", ...flags, "a.js"]);
      const found = diagnostics(result).map(it => it.replace(" error eslint", " warning eslint"));
      expect(found).toEqual([failed("a.js", missing), ...(hasWarnings ? debuggers("a.js") : [])]);
      expect(result.exitCode).toBe(1);
    });
  });

  // import/no-cycle makes `bun lint` look at these files a second time, when it knows all of them.
  const cycle = (other: string) =>
    `import { it as other } from "./${other}";\nexport const it = (\n  <b c={other}>\n    <e />\n  </b>\n);\n`;
  const cycles = (...names: string[]) => names.map(it => `${it} warning import(no-cycle): Dependency cycle detected`);

  test("the error of a JavaScript rule stays when a rule about several files is on too", async () => {
    const config = oxlintrc(
      { "import/no-cycle": "warn", "mini/in-listener": "warn" },
      { plugins: ["import"], jsPlugins: ["./plugin.mjs"] },
    );
    const project = { "plugin.mjs": plugin, "a.jsx": cycle("b.jsx"), "b.jsx": cycle("a.jsx"), ...config };
    const result = await lint(project, ["-f", "json", "a.jsx", "b.jsx"]);
    expect(diagnostics(result)).toEqual(
      [...["a.jsx", "b.jsx"].map(it => failed(it, missing)), ...cycles("a.jsx", "b.jsx")].sort(),
    );
    expect(result.exitCode).toBe(1);
  });

  // eslint-plugin-react's rule calls `" ".repeat(-1)` for every element here, and V8 throws this for it. oxlint doesn't have the
  // rule itself, so it can only run it as a JavaScript plugin's rule, like `mini/range-error` above.
  describe("a native rule that throws", () => {
    const element = 'const a = (\n  <b\n    c="d"\n  >\n    <e />\n  </b>\n);\ndebugger;\n';
    const project = (severity: string) => ({
      ...oxlintrc({ "no-debugger": "warn", "react/jsx-indent": [severity, -1] }, { plugins: ["react"] }),
      "a.jsx": element,
      "disabled.jsx": `/* eslint-disable */\n${element}`,
      "no-element.js": "debugger;\n",
    });
    const rangeError = "RangeError: Invalid count value: -1";

    test.each(["warn", "error"])("prints the same error once per file when it's set to %s", async severity => {
      const result = await lint(project(severity), ["-f", "json", "a.jsx", "disabled.jsx", "no-element.js"]);
      expect(diagnostics(result)).toEqual(
        [...["a.jsx", "disabled.jsx"].map(it => failed(it, rangeError)), ...debuggers("a.jsx", "no-element.js")].sort(),
      );
      expect(result.exitCode).toBe(1);
    });

    test.each([
      [["--quiet"], false],
      [["--max-warnings", "0"], true],
      [["--fix"], true],
    ])("with %j", async (flags, hasWarnings) => {
      const result = await lint(project("warn"), ["-f", "json", ...flags, "a.jsx"]);
      expect(diagnostics(result)).toEqual([failed("a.jsx", rangeError), ...(hasWarnings ? debuggers("a.jsx") : [])]);
      expect(result.exitCode).toBe(1);
    });

    test("the error stays when a rule about several files is on too", async () => {
      const config = oxlintrc(
        { "import/no-cycle": "warn", "react/jsx-indent": ["warn", -1] },
        { plugins: ["import", "react"] },
      );
      const result = await lint({ "a.jsx": cycle("b.jsx"), "b.jsx": cycle("a.jsx"), ...config }, ["-f", "json"]);
      expect(diagnostics(result)).toEqual(
        [...["a.jsx", "b.jsx"].map(it => failed(it, rangeError)), ...cycles("a.jsx", "b.jsx")].sort(),
      );
      expect(result.exitCode).toBe(1);
    });

    test("prints what a JavaScript rule that throws prints in every format", async () => {
      const formats = ["default", "stylish", "unix", "github", "checkstyle", "junit", "gitlab", "json"];
      const files = { "plugin.mjs": plugin, "a.jsx": element };
      const native = oxlintrc({ "react/jsx-indent": ["warn", -1] }, { plugins: ["react"] });
      const script = oxlintrc({ "mini/range-error": "warn" }, { jsPlugins: ["./plugin.mjs"] });
      for (const format of formats) {
        const [a, b] = await Promise.all(
          [native, script].map(config => lint({ ...files, ...config }, ["-f", format, "a.jsx"])),
        );
        // The fingerprint is a hash of the message, which has the path of the temporary directory in it.
        const timeless = (text: string) =>
          text.replace(/[\d.]+(?=m?s\b)|"start_time": [\d.]+|"fingerprint": "\w+"/g, "");
        expect({ format, stdout: timeless(a.tidy(a.stdout)), exitCode: a.exitCode }).toEqual({
          format,
          stdout: timeless(b.tidy(b.stdout)),
          exitCode: 1,
        });
      }
    });
  });

  // When a rule of a JavaScript plugin throws, oxlint has nothing from any rule of any JavaScript plugin for that file, and everything
  // from its own rules.
  describe("what the other rules found in the file", () => {
    const alpha = `
      const boom = where => { throw new Error("boom " + where); };
      const at = (name, where) => ({ create: () => ({ Identifier(node) { if (node.name === name) boom(where); } }) });
      const says = (type, message) => ({ create: context => ({ [type]: node => context.report({ node, message }) }) });
      export default {
        meta: { name: "alpha" },
        rules: {
          vars: says("VariableDeclaration", "alpha saw a declaration"),
          start: says("Program", "alpha saw the start"),
          "throws-in-create": { create: () => boom("in create") },
          "throws-early": at("early", "early"),
          "throws-late": at("late", "late"),
          "throws-at-exit": { create: () => ({ "Program:exit": () => boom("at exit") }) },
          "throws-in-before": { createOnce: () => ({ before: () => boom("in before"), Identifier() {} }) },
          "throws-in-after": { createOnce: () => ({ after: () => boom("in after"), Identifier() {} }) },
          "reports-then-throws": {
            create: context => ({
              Program: node => context.report({ node, message: "alpha reported, then threw" }),
              "Program:exit": () => boom("after reporting"),
            }),
          },
        },
      };
    `;
    const beta = `
      const says = (type, message) => ({ create: context => ({ [type]: node => context.report({ node, message }) }) });
      export default {
        meta: { name: "beta" },
        rules: {
          calls: says("CallExpression", "beta saw a call"),
          end: says("Program:exit", "beta saw the end"),
          fixes: {
            meta: { fixable: "code" },
            create: context => ({
              Literal(node) {
                if (node.value === 1) context.report({ node, message: "beta wants 2", fix: it => it.replaceText(node, "2") });
              },
            }),
          },
        },
      };
    `;
    const plugins = { "alpha.mjs": alpha, "beta.mjs": beta };
    const code =
      "debugger;\nvar first = early == 1;\nuse(first);\ndebugger;\nvar second = late == 1;\nuse(second);\ndebugger;\n";
    const on = {
      "alpha/vars": "warn",
      "alpha/start": "warn",
      "beta/calls": "warn",
      "beta/end": "warn",
      "no-debugger": "warn",
      "no-var": "warn",
      eqeqeq: "warn",
    };
    const config = (rules: Record<string, unknown>, more = {}) =>
      oxlintrc({ ...on, ...rules }, { jsPlugins: ["./alpha.mjs", "./beta.mjs"], ...more });

    type Labeled = {
      filename: string;
      code?: string;
      message: string;
      labels: { span: { offset: number; length: number } }[];
    };
    /** Every diagnostic in the order it's printed, as `file code offset+length`, or `file Error: message` for a rule that threw. */
    const inOrder = ({ stdout }: { stdout: string }) =>
      (JSON.parse(stdout).diagnostics as Labeled[]).map(it => {
        if (it.message.startsWith("Error running JS plugin.")) return `${it.filename} ${it.message.split("\n")[2]}`;
        const [{ span }] = it.labels;
        return `${it.filename} ${it.code ?? it.message.split(" (")[0]} ${span.offset}+${span.length}`;
      });
    const inFile = (file: string, found: string[]) => found.map(it => `${file} ${it}`);
    const builtIn = [
      "eslint(no-debugger) 0+9",
      "eslint(no-var) 10+3",
      "eslint(eqeqeq) 28+2",
      "eslint(no-debugger) 46+9",
      "eslint(no-var) 56+3",
      "eslint(eqeqeq) 74+2",
      "eslint(no-debugger) 93+9",
    ];
    const ofPlugins = [
      "alpha(start) 0+103",
      "alpha(vars) 10+23",
      "beta(calls) 34+10",
      "alpha(vars) 56+23",
      "beta(calls) 80+11",
      "beta(end) 0+103",
    ];

    // All of this is what oxlint 1.87 prints, in its order.
    test("is all there when nothing throws", async () => {
      const result = await lint({ ...plugins, ...config({}), "a.js": code }, ["-f", "json", "a.js"]);
      expect(inOrder(result)).toEqual(inFile("a.js", [...builtIn, ...ofPlugins]));
      expect(result.exitCode).toBe(0);
    });

    test.each([
      ["throws-in-create", "in create"],
      ["throws-early", "early"],
      ["throws-late", "late"],
      ["throws-at-exit", "at exit"],
      ["throws-in-before", "in before"],
      ["throws-in-after", "in after"],
      ["reports-then-throws", "after reporting"],
    ])("alpha/%s: the built-in rules' findings stay, those of both plugins go", async (rule, where) => {
      const files = { ...plugins, ...config({ [`alpha/${rule}`]: "warn" }), "a.js": code };
      const result = await lint(files, ["-f", "json", "a.js"]);
      expect(inOrder(result)).toEqual(inFile("a.js", [...builtIn, `Error: boom ${where}`]));
      expect(result.exitCode).toBe(1);
    });

    test("the first throw counts", async () => {
      const files = {
        ...plugins,
        ...config({ "alpha/throws-late": "warn", "alpha/throws-early": "warn" }),
        "a.js": code,
      };
      const result = await lint(files, ["-f", "json", "a.js"]);
      expect(inOrder(result)).toEqual(inFile("a.js", [...builtIn, "Error: boom early"]));
      expect(result.exitCode).toBe(1);
    });

    test("another file keeps everything", async () => {
      const files = { "a.js": code, "b.js": code.replace("late", "soon") };
      const result = await lint({ ...plugins, ...config({ "alpha/throws-late": "warn" }), ...files }, [
        "-f",
        "json",
        "--threads",
        "1",
        "a.js",
        "b.js",
      ]);
      expect(inOrder(result)).toEqual([
        ...inFile("a.js", [...builtIn, "Error: boom late"]),
        ...inFile("b.js", [...builtIn, ...ofPlugins]),
      ]);
      expect(result.exitCode).toBe(1);
    });

    test("a comment that disables a plugin's rule is unused then", async () => {
      const disabled = `/* oxlint-disable alpha/vars, no-debugger */\n${code}`;
      const flags = ["-f", "json", "--report-unused-disable-directives", "a.js"];
      const kept = ["eslint(no-var) 55+3", "eslint(eqeqeq) 73+2", "eslint(no-var) 101+3", "eslint(eqeqeq) 119+2"];
      const [fine, thrown, all] = await Promise.all([
        lint({ ...plugins, ...config({}), "a.js": disabled }, flags),
        lint({ ...plugins, ...config({ "alpha/throws-late": "warn" }), "a.js": disabled }, flags),
        lint(
          { ...plugins, ...config({ "alpha/throws-late": "warn" }), "a.js": `/* oxlint-disable */\n${code}` },
          flags,
        ),
      ]);
      expect(inOrder(fine)).toEqual(
        inFile("a.js", [...kept, "alpha(start) 45+103", "beta(calls) 79+10", "beta(calls) 125+11", "beta(end) 45+103"]),
      );
      expect(inOrder(thrown)).toEqual(
        inFile("a.js", [...kept, "Error: boom late", "Unused oxlint-disable directive 18+10"]),
      );
      expect(inOrder(all)).toEqual(["a.js Error: boom late"]);
      expect([fine.exitCode, thrown.exitCode, all.exitCode]).toEqual([0, 1, 1]);
    });

    test("with a rule about several files", async () => {
      const importing = (other: string) =>
        `import { it as other } from "./${other}";\nexport const it = other;\n${code}`;
      const files = { "a.js": importing("b.js"), "b.js": importing("a.js").replace("late", "soon") };
      const rules = { "import/no-cycle": "warn", "alpha/throws-late": "warn" };
      const result = await lint({ ...plugins, ...config(rules, { plugins: ["import"] }), ...files }, [
        "-f",
        "json",
        "--threads",
        "1",
        "a.js",
        "b.js",
      ]);
      const own = [
        "import(no-cycle) 28+8",
        "eslint(no-debugger) 63+9",
        "eslint(no-var) 73+3",
        "eslint(eqeqeq) 91+2",
        "eslint(no-debugger) 109+9",
        "eslint(no-var) 119+3",
        "eslint(eqeqeq) 137+2",
        "eslint(no-debugger) 156+9",
      ];
      expect(inOrder(result)).toEqual([
        ...inFile("a.js", [...own, "Error: boom late"]),
        ...inFile("b.js", [
          ...own,
          "alpha(start) 0+166",
          "alpha(vars) 45+17",
          "alpha(vars) 73+23",
          "beta(calls) 97+10",
          "alpha(vars) 119+23",
          "beta(calls) 143+11",
          "beta(end) 0+166",
        ]),
      ]);
      expect(result.exitCode).toBe(1);
    });

    test.each(["throws-in-create", "throws-late", "throws-at-exit"])(
      "--fix still applies the built-in rules' fixes: alpha/%s",
      async rule => {
        using dir = tempDir("bun-lint-rule-throws", {
          ...plugins,
          ...config({ "beta/fixes": "warn", [`alpha/${rule}`]: "warn" }),
          "a.js": code,
        });
        await using proc = spawn({
          cmd: [bunExe(), "lint", "-f", "json", "--fix", "a.js"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        const found = inOrder({ stdout }).map(it => it.replace(/boom .*/, "boom"));
        const left = builtIn.filter(it => !it.includes("no-var"));
        expect(found.sort()).toEqual(inFile("a.js", [...left, "Error: boom"]).sort());
        expect(await Bun.file(`${dir}/a.js`).text()).toBe(code.replaceAll("var ", "const "));
        expect(exitCode).toBe(1);
      },
    );

    // oxlint has neither react/jsx-indent, react/jsx-indent-props nor import/no-extraneous-dependencies. It could only run them as rules
    // of a JavaScript plugin, so here they share the fate of those. The lists are what oxlint 1.87 prints for this file with the
    // rules that it has.
    describe("native rules that oxlint doesn't have count as rules of a JavaScript plugin", () => {
      const element =
        'import x from "listed";\ndebugger;\nvar first = use(x);\nconst a = (\n  <b\n    c="d"\n  >\n    <e />\n  </b>\n);\ndebugger;\nvar second = use(a, first);\n';
      const project = (rules: Record<string, unknown>) => ({
        ...plugins,
        ...oxlintrc(
          {
            "alpha/vars": "warn",
            "beta/calls": "warn",
            "beta/end": "warn",
            "no-debugger": "warn",
            "no-var": "warn",
            "import/no-extraneous-dependencies": "warn",
            "react/jsx-indent-props": ["warn", 8],
            ...rules,
          },
          { plugins: ["react", "import"], jsPlugins: ["./alpha.mjs", "./beta.mjs"] },
        ),
        "package.json": `{"name":"root"}`,
        "node_modules/listed/package.json": `{"name":"listed","main":"index.js"}`,
        "node_modules/listed/index.js": "module.exports = 1;\n",
        "a.jsx": element,
      });
      const own = [
        "eslint(no-debugger) 24+9",
        "eslint(no-var) 34+3",
        "eslint(no-debugger) 105+9",
        "eslint(no-var) 115+3",
      ];

      test("they report when nothing throws", async () => {
        const result = await lint(project({}), ["-f", "json", "a.jsx"]);
        expect(inOrder(result).sort()).toEqual(
          inFile("a.jsx", [
            ...own,
            "import(no-extraneous-dependencies) 0+23",
            "react(jsx-indent-props) 75+5",
            "alpha(vars) 34+19",
            "beta(calls) 46+6",
            "alpha(vars) 54+50",
            "alpha(vars) 115+27",
            "beta(calls) 128+13",
            "beta(end) 0+143",
          ]).sort(),
        );
        expect(result.exitCode).toBe(0);
      });

      test.each([
        ["one of them throws", { "react/jsx-indent": ["warn", -1] }, "RangeError: Invalid count value: -1"],
        ["a JavaScript rule throws", { "alpha/throws-at-exit": "warn" }, "Error: boom at exit"],
        ["both throw", { "alpha/throws-at-exit": "warn", "react/jsx-indent": ["warn", -1] }, "Error: boom at exit"],
      ])("%s: only the findings of oxlint's own rules stay", async (_, rules, error) => {
        const result = await lint(project(rules), ["-f", "json", "a.jsx"]);
        expect(inOrder(result)).toEqual(inFile("a.jsx", [...own, error]));
        expect(result.exitCode).toBe(1);
      });
    });
  });
});

describe.concurrent("with an ESLint config", () => {
  const config = (rule: string, severity: string) => ({
    "eslint.config.mjs": `
      import mini from "./plugin.mjs";
      export default [{ plugins: { mini }, rules: { "no-debugger": "warn", "mini/${rule}": "${severity}" } }];
    `,
  });

  // All of this is what ESLint 10.12 prints after "Oops! Something went wrong!" and before the stack.
  test.each(["warn", "error"])("a JavaScript rule set to %s that throws in a listener ends the run", async severity => {
    const { stdout, stderr, exitCode } = await lint({ ...files, ...config("in-listener", severity) }, names);
    expect(stderr).toContain(
      `rror: allowance file 'allow.json' is missing\nOccurred while linting <dir>/a.js:1\nRule: "mini/in-listener"\n`,
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
  });

  const loading = (name: string) => `Error while loading rule 'mini/create-throws-${name}': `;
  test.each([
    ["error", loading("error") + "real error"],
    ["type-error", loading("type-error") + "real type error"],
    ["empty-message", loading("empty-message")],
    // ESLint changes the message of what it has caught, and these have none to change.
    ["string", "Cannot create property 'message' on string 'just a string'"],
    ["number", "Cannot create property 'message' on number '5'"],
    ["symbol", "Cannot create property 'message' on symbol 'Symbol(s)'"],
    ["undefined", "Cannot read properties of undefined (reading 'message')"],
    ["null", "Cannot read properties of null (reading 'message')"],
  ])("a JavaScript rule that throws in create() ends the run: %s", async (name, said) => {
    const { stdout, stderr, exitCode } = await lint({ ...files, ...config(`create-throws-${name}`, "warn") }, names);
    expect(stderr).toContain(`rror: ${said}\nOccurred while linting <dir>/a.js\n`);
    expect(stderr).not.toContain("Rule:");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
  });
});

test.concurrent("without a config, a native rule that throws ends the run", async () => {
  const element = 'const a = (\n  <b\n    c="d"\n  >\n    <e />\n  </b>\n);\n';
  const { stdout, stderr, exitCode } = await lint({ "a.jsx": element }, ["--rule", 'react/jsx-indent: ["warn", -1]']);
  expect(stderr).toBe(
    `error: RangeError: Invalid count value: -1\nOccurred while linting <dir>/a.jsx:2\nRule: "react/jsx-indent"\n`,
  );
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
});
