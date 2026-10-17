// What happens when a rule throws instead of reporting, for example because a file named in its options is missing. A rule of a
// JavaScript plugin throws for real. A native rule calls `cx.throw()`, which has to look the same.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

// A process that runs a rule in JavaScript starts a VM, which takes seconds in a debug build.
const timeout = isDebug || isASAN ? 120_000 : 10_000;

/** Runs `bun lint ...args` in a temporary directory with `files`. `written`: what is in each of `reads` afterwards. */
async function lint(files: Record<string, string>, args: string[], reads: string[] = []) {
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
  const written = Object.fromEntries(reads.map(it => [it, readFileSync(join(String(dir), it), "utf8")]));
  return { stdout, stderr: tidy(stderr), exitCode, tidy, written };
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

type Diagnostic = {
  message: string;
  code?: string;
  severity: string;
  filename: string;
  labels: { span: { offset: number; length: number } }[];
};

/** What `bun lint -f json` found where an `.oxlintrc.json` is, in the order it printed it. `tidy` is that of `lint`. */
type Found = { diagnostics: Diagnostic[]; exitCode: number; tidy: (text: string) => string };

/** Runs `bun lint -f json ...args`, which prints the report, and `says` to stderr: nothing, unless it fixed something. */
async function json(files: Record<string, string>, args: string[], { reads = [] as string[], says = "" } = {}) {
  const { stdout, stderr, ...rest } = await lint(files, ["-f", "json", ...args], reads);
  // Checked before the report is read: a run that died says why here, and what it printed is no JSON.
  expect(stderr).toBe(says);
  return { diagnostics: JSON.parse(stdout).diagnostics as Diagnostic[], ...rest };
}

/**
 * One `bun lint -f json` for many projects. Each is a directory with an `.oxlintrc.json` of its own, which is the config that
 * oxlint uses for the files in it. Add a project, and what to lint in it, while the tests are collected. What that returns
 * waits for the run and gives what it found in the project, as a run in that directory alone prints it.
 *
 * With ASAN a process that has run a rule in JavaScript takes seconds, however little it linted, and `bun test` runs five
 * tests at a time. So the projects that need nothing but the report share a process.
 */
function together() {
  // The config in the working directory makes it a run of oxlint's. No file is linted with it.
  const all: Record<string, string> = { ".oxlintrc.json": "{}" };
  const paths: string[] = [];
  let count = 0;
  let run: ReturnType<typeof json> | undefined;
  return (files: Record<string, string>, args: string[]) => {
    const name = `project-${count++}`;
    for (const [path, text] of Object.entries(files)) all[`${name}/${path}`] = text;
    paths.push(...args.map(it => `${name}/${it}`));
    return async (): Promise<Found> => {
      const { diagnostics, exitCode, tidy } = await (run ??= json(all, paths));
      const own = diagnostics
        .map(it => ({ ...it, filename: it.filename.replaceAll("\\", "/") }))
        .filter(it => it.filename.startsWith(`${name}/`))
        .map(it => ({ ...it, filename: it.filename.slice(name.length + 1) }));
      // The exit code is 1 as soon as one project has an error. It says something about this project only if a run of this
      // project alone ends with the same.
      const alone = own.some(it => it.severity === "error") ? 1 : 0;
      expect({ name, exitCode }).toEqual({ name, exitCode: alone });
      return { diagnostics: own, exitCode, tidy: text => tidy(text).replaceAll(`<dir>/${name}/`, "<dir>/") };
    };
  };
}

/** Every diagnostic as `file severity code: message`, sorted, without the stack frames: those are the engine's. */
function diagnostics({ diagnostics, tidy }: Found) {
  return diagnostics
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
  // The projects in which a rule throws and which need no flag, by what the rules in them are set to. The run of those that
  // are set to "warn" has no rule that is set to "error", so its exit code is what the errors of these rules alone make it.
  const thrown = { warn: together(), error: together() };

  // All of this is what oxlint 1.87 prints.
  describe("a JavaScript rule that throws", () => {
    for (const severity of ["warn", "error"] as const) {
      const found = thrown[severity]({ ...files, ...withPlugin({ "mini/in-create": severity }) }, names);
      test(`in create() is an error in every file when it's set to ${severity}`, { timeout }, async () => {
        const result = await found();
        expect(diagnostics(result)).toEqual(
          [
            ...["a.js", "disabled.js", "no-identifier.js"].map(it => failed(it, missing)),
            ...debuggers("a.js", "no-identifier.js"),
          ].sort(),
        );
        expect(result.exitCode).toBe(1);
      });
    }

    // These come before the tests below: those wait for the two runs that the tests above have started, and each of these
    // has a process of its own.
    test.each([
      [["--quiet"], false],
      [["--max-warnings", "0"], true],
      [["--deny-warnings"], true],
      [["--fix"], true],
    ])("with %j", { timeout }, async (flags, hasWarnings) => {
      const config = withPlugin({ "mini/in-create": "warn" });
      const result = await json({ ...files, ...config }, [...flags, "a.js"]);
      const found = diagnostics(result).map(it => it.replace(" error eslint", " warning eslint"));
      expect(found).toEqual([failed("a.js", missing), ...(hasWarnings ? debuggers("a.js") : [])]);
      expect(result.exitCode).toBe(1);
    });

    for (const severity of ["warn", "error"] as const) {
      const found = thrown[severity]({ ...files, ...withPlugin({ "mini/in-listener": severity }) }, names);
      test(`in a listener is an error where the listener runs when it's set to ${severity}`, { timeout }, async () => {
        const result = await found();
        expect(diagnostics(result)).toEqual(
          [
            ...["a.js", "disabled.js"].map(it => failed(it, missing)),
            ...debuggers("a.js", "no-identifier.js"),
            "no-identifier.js warning mini(fine): fine saw a debugger",
          ].sort(),
        );
        expect(result.exitCode).toBe(1);
      });
    }

    for (const [rule, error] of [
      ["mini/reports-first", missing],
      ["mini/range-error", "RangeError: Invalid count value: -1"],
      ["mini/own-class", "AllowanceError: no file"],
      ["mini/two-lines", "Error: line one\nline two"],
      ["mini/not-an-error", "Unknown error"],
    ]) {
      const found = thrown.warn({ ...files, ...withPlugin({ [rule]: "warn" }) }, ["a.js"]);
      test(rule, { timeout }, async () => {
        const result = await found();
        expect(diagnostics(result)).toEqual([failed("a.js", error), ...debuggers("a.js")]);
        expect(result.exitCode).toBe(1);
      });
    }
  });

  // import/no-cycle makes `bun lint` look at these files a second time, when it knows all of them.
  const cycle = (other: string) =>
    `import { it as other } from "./${other}";\nexport const it = (\n  <b c={other}>\n    <e />\n  </b>\n);\n`;
  const cycles = (...names: string[]) => names.map(it => `${it} warning import(no-cycle): Dependency cycle detected`);

  test("the error of a JavaScript rule stays when a rule about several files is on too", { timeout }, async () => {
    const config = oxlintrc(
      { "import/no-cycle": "warn", "mini/in-listener": "warn" },
      { plugins: ["import"], jsPlugins: ["./plugin.mjs"] },
    );
    const project = { "plugin.mjs": plugin, "a.jsx": cycle("b.jsx"), "b.jsx": cycle("a.jsx"), ...config };
    const result = await json(project, ["a.jsx", "b.jsx"]);
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
      const result = await json(project(severity), ["a.jsx", "disabled.jsx", "no-element.js"]);
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
      const result = await json(project("warn"), [...flags, "a.jsx"]);
      expect(diagnostics(result)).toEqual([failed("a.jsx", rangeError), ...(hasWarnings ? debuggers("a.jsx") : [])]);
      expect(result.exitCode).toBe(1);
    });

    test("the error stays when a rule about several files is on too", async () => {
      const config = oxlintrc(
        { "import/no-cycle": "warn", "react/jsx-indent": ["warn", -1] },
        { plugins: ["import", "react"] },
      );
      const result = await json({ "a.jsx": cycle("b.jsx"), "b.jsx": cycle("a.jsx"), ...config }, []);
      expect(diagnostics(result)).toEqual(
        [...["a.jsx", "b.jsx"].map(it => failed(it, rangeError)), ...cycles("a.jsx", "b.jsx")].sort(),
      );
      expect(result.exitCode).toBe(1);
    });

    test("prints what a JavaScript rule that throws prints in every format", { timeout }, async () => {
      const formats = ["default", "stylish", "unix", "github", "checkstyle", "junit", "gitlab", "json"];
      const files = { "plugin.mjs": plugin, "a.jsx": element };
      const native = oxlintrc({ "react/jsx-indent": ["warn", -1] }, { plugins: ["react"] });
      const script = oxlintrc({ "mini/range-error": "warn" }, { jsPlugins: ["./plugin.mjs"] });
      // What isn't the same in every run or on every machine: how long it took, how many threads there are, and the
      // fingerprint, which is a hash of the message, which has the path of the temporary directory in it.
      const steady = (text: string) =>
        text
          .replace(/[\d.]+m?s\b|(?<="start_time": )[\d.]+/g, "<time>")
          .replace(/\d+(?= threads\b)|(?<="threads_count": )\d+/g, "<threads>")
          .replace(/(?<="fingerprint": ")\w+/g, "<hash>");
      const print = async (format: string) => {
        const [ofNative, ofScript] = await Promise.all(
          [native, script].map(async config => {
            const result = await lint({ ...files, ...config }, ["-f", format, "a.jsx"]);
            return { stdout: steady(result.tidy(result.stdout)), stderr: result.stderr, exitCode: result.exitCode };
          }),
        );
        expect({ format, ...ofNative }).toEqual({ format, ...ofScript });
        expect({ format, ...ofScript }).toMatchObject({ stderr: "", exitCode: 1 });
        return [format, ofScript.stdout] as const;
      };
      // Two formats at a time: each is one more process that runs a rule in JavaScript.
      const printed: (readonly [string, string])[] = [];
      for (let at = 0; at < formats.length; at += 2) {
        printed.push(...(await Promise.all(formats.slice(at, at + 2).map(print))));
      }
      expect(Object.fromEntries(printed)).toMatchInlineSnapshot(`
        {
          "checkstyle": 
        "<?xml version="1.0" encoding="utf-8"?><checkstyle version="4.3"><file name="a.jsx"><error line="0" column="0" severity="error" message="Error running JS plugin.
        File path: <dir>/a.jsx
        RangeError: Invalid count value: -1" source="" /></file></checkstyle>
        "
        ,
          "default": 
        "error: Error running JS plugin.
        File path: <dir>/a.jsx
        RangeError: Invalid count value: -1
            at a.jsx:0

        Linted 1 file [<time>]
        "
        ,
          "github": 
        "::error file=a.jsx,line=0,endLine=0,col=0,endColumn=0,title=oxlint::a.jsx:0:0: Error running JS plugin.%0AFile path: <dir>/a.jsx%0ARangeError: Invalid count value: -1

        Found 0 warnings and 1 error.
        Finished in <time> on 1 file with 1 rules using <threads> threads.
        "
        ,
          "gitlab": 
        "[
          {
            "description": "Error running JS plugin./nFile path: <dir>/a.jsx/nRangeError: Invalid count value: -1",
            "check_name": "",
            "fingerprint": "<hash>",
            "severity": "critical",
            "location": {
              "path": "a.jsx",
              "lines": {
                "begin": 0,
                "end": 0
              }
            }
          }
        ]"
        ,
          "json": 
        "{ "diagnostics": [{"message": "Error running JS plugin./nFile path: <dir>/a.jsx/nRangeError: Invalid count value: -1","severity": "error","filename": "a.jsx","labels": []}],
                      "number_of_files": 1,
                      "number_of_rules": 1,
                      "threads_count": <threads>,
                      "start_time": <time>
                    }
                    "
        ,
          "junit": 
        "<?xml version="1.0" encoding="UTF-8"?>
        <testsuites name="Oxlint" tests="1" failures="0" errors="1">
            <testsuite name="a.jsx" tests="1" disabled="0" errors="1" failures="0">
                <testcase name="">
                    <error message="Error running JS plugin.
        File path: <dir>/a.jsx
        RangeError: Invalid count value: -1">line 0, column 0, Error running JS plugin.
        File path: <dir>/a.jsx
        RangeError: Invalid count value: -1</error>
                </testcase>
            </testsuite>
        </testsuites>
        "
        ,
          "stylish": 
        "
        <dir>/a.jsx
          0:0  error  Error running JS plugin.
        File path: <dir>/a.jsx
        RangeError: Invalid count value: -1  

        ✖ 1 problem (1 error, 0 warnings)
        "
        ,
          "unix": 
        "a.jsx:0:0: Error running JS plugin.
        File path: <dir>/a.jsx
        RangeError: Invalid count value: -1 [Error]

        1 problem
        "
        ,
        }
      `);
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

    /** Every diagnostic in the order it's printed, as `file code offset+length`, or `file Error: message` for a rule that threw. */
    const inOrder = ({ diagnostics }: Found) =>
      diagnostics.map(it => {
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
    test("is all there when nothing throws", { timeout }, async () => {
      const result = await json({ ...plugins, ...config({}), "a.js": code }, ["a.js"]);
      expect(inOrder(result)).toEqual(inFile("a.js", [...builtIn, ...ofPlugins]));
      expect(result.exitCode).toBe(0);
    });

    for (const [rule, where] of [
      ["throws-in-create", "in create"],
      ["throws-early", "early"],
      ["throws-late", "late"],
      ["throws-at-exit", "at exit"],
      ["throws-in-before", "in before"],
      ["throws-in-after", "in after"],
      ["reports-then-throws", "after reporting"],
    ]) {
      const found = thrown.warn({ ...plugins, ...config({ [`alpha/${rule}`]: "warn" }), "a.js": code }, ["a.js"]);
      test(`alpha/${rule}: the built-in rules' findings stay, those of both plugins go`, { timeout }, async () => {
        const result = await found();
        expect(inOrder(result)).toEqual(inFile("a.js", [...builtIn, `Error: boom ${where}`]));
        expect(result.exitCode).toBe(1);
      });
    }

    const twice = thrown.warn(
      { ...plugins, ...config({ "alpha/throws-late": "warn", "alpha/throws-early": "warn" }), "a.js": code },
      ["a.js"],
    );
    test("the first throw counts", { timeout }, async () => {
      const result = await twice();
      expect(inOrder(result)).toEqual(inFile("a.js", [...builtIn, "Error: boom early"]));
      expect(result.exitCode).toBe(1);
    });

    test("another file keeps everything", { timeout }, async () => {
      const files = { "a.js": code, "b.js": code.replace("late", "soon") };
      const result = await json({ ...plugins, ...config({ "alpha/throws-late": "warn" }), ...files }, [
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

    test("a comment that disables a plugin's rule is unused then", { timeout }, async () => {
      const disabled = `/* oxlint-disable alpha/vars, no-debugger */\n${code}`;
      const flags = ["--report-unused-disable-directives", "a.js"];
      const kept = ["eslint(no-var) 55+3", "eslint(eqeqeq) 73+2", "eslint(no-var) 101+3", "eslint(eqeqeq) 119+2"];
      const [fine, thrown, all] = await Promise.all([
        json({ ...plugins, ...config({}), "a.js": disabled }, flags),
        json({ ...plugins, ...config({ "alpha/throws-late": "warn" }), "a.js": disabled }, flags),
        json(
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

    test("with a rule about several files", { timeout }, async () => {
      const importing = (other: string) =>
        `import { it as other } from "./${other}";\nexport const it = other;\n${code}`;
      const files = { "a.js": importing("b.js"), "b.js": importing("a.js").replace("late", "soon") };
      const rules = { "import/no-cycle": "warn", "alpha/throws-late": "warn" };
      const result = await json({ ...plugins, ...config(rules, { plugins: ["import"] }), ...files }, [
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
      { timeout },
      async rule => {
        const files = { ...plugins, ...config({ "beta/fixes": "warn", [`alpha/${rule}`]: "warn" }), "a.js": code };
        // Two fixes, both of no-var. `beta/fixes` has two more, which are gone with the rest of what the plugins found.
        const result = await json(files, ["--fix", "a.js"], { reads: ["a.js"], says: "Fixed 2 problems in 1 file\n" });
        const found = inOrder(result).map(it => it.replace(/boom .*/, "boom"));
        const left = builtIn.filter(it => !it.includes("no-var"));
        expect(found.sort()).toEqual(inFile("a.js", [...left, "Error: boom"]).sort());
        expect(result.written["a.js"]).toBe(code.replaceAll("var ", "const "));
        expect(result.exitCode).toBe(1);
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

      test("they report when nothing throws", { timeout }, async () => {
        const result = await json(project({}), ["a.jsx"]);
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

      for (const [name, rules, error] of [
        ["one of them throws", { "react/jsx-indent": ["warn", -1] }, "RangeError: Invalid count value: -1"],
        ["a JavaScript rule throws", { "alpha/throws-at-exit": "warn" }, "Error: boom at exit"],
        ["both throw", { "alpha/throws-at-exit": "warn", "react/jsx-indent": ["warn", -1] }, "Error: boom at exit"],
      ] as const) {
        const found = thrown.warn(project(rules), ["a.jsx"]);
        test(`${name}: only the findings of oxlint's own rules stay`, { timeout }, async () => {
          const result = await found();
          expect(inOrder(result)).toEqual(inFile("a.jsx", [...own, error]));
          expect(result.exitCode).toBe(1);
        });
      }
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

  // All of this is what ESLint 10.12 prints after "Oops! Something went wrong!" and before the stack, but for the first
  // word: it has the name of the error there.
  test.each(["warn", "error"])(
    "a JavaScript rule set to %s that throws in a listener ends the run",
    { timeout },
    async severity => {
      const { stdout, stderr, exitCode } = await lint({ ...files, ...config("in-listener", severity) }, names);
      expect(stderr).toBe(
        `error: allowance file 'allow.json' is missing\nOccurred while linting <dir>/a.js:1\nRule: "mini/in-listener"\n`,
      );
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
    },
  );

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
  ])("a JavaScript rule that throws in create() ends the run: %s", { timeout }, async (name, said) => {
    const { stdout, stderr, exitCode } = await lint({ ...files, ...config(`create-throws-${name}`, "warn") }, names);
    // Without the `Rule:` line that a throw in a listener has.
    expect(stderr).toBe(`error: ${said}\nOccurred while linting <dir>/a.js\n`);
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
