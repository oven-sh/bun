import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

const pagesDir = join(import.meta.dir, "../../../docs/lint/rules");

type Env = Record<string, string | undefined>;

async function lint(files: Record<string, string>, args: string[], env: Env = {}) {
  using dir = tempDir("bun-lint-explain", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "lint", ...args],
    env: { ...bunEnv, COLUMNS: "80", ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** Like `lint`, but stdout is a terminal. */
async function lintInTerminal(args: string[], env: Env = {}) {
  using dir = tempDir("bun-lint-explain", {});
  let output = "";
  const decoder = new TextDecoder();
  await using proc = Bun.spawn({
    cmd: [bunExe(), "lint", ...args],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    terminal: { cols: 200, rows: 50, data: (_, chunk) => void (output += decoder.decode(chunk, { stream: true })) },
  });
  const exitCode = await proc.exited;
  return { output: output.replaceAll("\r\n", "\n"), exitCode };
}

interface Listed {
  scope: string;
  value: string;
  category: string | null;
  type_aware: boolean;
  fix: string;
  default: boolean;
  docs_url: string;
  id: string;
  aliases: string[];
  description: string;
  kind: "problem" | "suggestion" | "layout" | null;
  deprecated: boolean;
  on_by_default: "error" | "warn" | false;
  modes: ("native" | "eslint" | "oxlint")[];
  schema: unknown[] | Record<string, unknown> | null;
  default_options: unknown[] | null;
}

const listRules = async () => JSON.parse((await lint({}, ["--rules", "-f", "json"])).stdout) as Listed[];

/** Returns every docs page as `<plugin>/<rule>`. */
const pages = () => [...new Bun.Glob("*/**/*.mdx").scanSync(pagesDir)].map(it => it.replaceAll("\\", "/").slice(0, -4));

function frontmatter(page: string) {
  const text = readFileSync(join(pagesDir, page + ".mdx"), "utf8");
  const field = (key: string) => JSON.parse(new RegExp(`^${key}: (".*")$`, "m").exec(text.split("\n---\n")[0])![1]);
  return { description: field("description") as string };
}

const base = "https://bun.com/docs/lint/rules/";

describe.concurrent("--rules -f json", () => {
  test("has oxlint's keys first, then Bun's", async () => {
    const rules = await listRules();
    expect(rules.length).toBeGreaterThan(1000);
    expect([...new Set(rules.map(it => Object.keys(it).join()))]).toEqual([
      "scope,value,category,type_aware,fix,default,docs_url,id,aliases,description,kind,deprecated,on_by_default,modes,schema,default_options",
    ]);
    expect(rules.find(it => it.id === "@typescript-eslint/no-floating-promises")).toEqual({
      scope: "typescript",
      value: "no-floating-promises",
      category: "correctness",
      type_aware: true,
      fix: "fixable_suggestion",
      default: true,
      docs_url: base + "typescript/no-floating-promises",
      id: "@typescript-eslint/no-floating-promises",
      aliases: ["typescript-eslint/no-floating-promises", "typescript/no-floating-promises"],
      description: frontmatter("typescript/no-floating-promises").description,
      kind: "problem",
      deprecated: false,
      on_by_default: false,
      modes: ["native", "eslint", "oxlint"],
      schema: [expect.objectContaining({ type: "object", additionalProperties: false })],
      default_options: [expect.objectContaining({ ignoreVoid: true, ignoreIIFE: false })],
    });
  });

  test("schema and default_options describe a rule's options", async () => {
    const rules = new Map((await listRules()).map(it => [it.id, it]));
    const options = (id: string) => ({
      schema: rules.get(id)!.schema,
      default_options: rules.get(id)!.default_options,
    });
    expect(options("no-console")).toEqual({
      schema: [
        {
          type: "object",
          properties: { allow: { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true } },
          additionalProperties: false,
        },
      ],
      default_options: [{}],
    });
    expect(options("eqeqeq").default_options).toEqual(["always"]);
    expect(options("@typescript-eslint/array-type").default_options).toEqual([{ default: "array" }]);
    // No options.
    expect(options("no-debugger")).toEqual({ schema: null, default_options: null });
    // Rules ported from oxlint take options but have no schema.
    expect(options("unicorn/filename-case")).toEqual({ schema: null, default_options: null });
    // Includes the options that Bun's built-in config sets.
    for (const id of ["no-unused-vars", "@typescript-eslint/no-unused-vars"])
      expect(options(id).default_options).toEqual([expect.objectContaining({ argsIgnorePattern: "^_" })]);
    // It also sets options for rules that are off by default.
    for (const id of ["no-unused-expressions", "@typescript-eslint/no-unused-expressions"])
      expect(options(id).default_options).toEqual([expect.objectContaining({ allowShortCircuit: true })]);
    expect([...rules.values()].filter(it => (it.schema === null) !== (it.default_options === null))).toEqual([]);
  });

  test("is the same no matter what config the project has", async () => {
    const [alone, eslint, oxlint] = await Promise.all([
      lint({}, ["--rules", "-f", "json"]),
      lint({ "eslint.config.mjs": "export default [];" }, ["--rules", "-f", "json"]),
      lint({ ".oxlintrc.json": "{}", "bunfig.toml": '[lint.rules]\n"no-var" = "off"\n' }, ["--rules", "-f", "json"]),
    ]);
    expect(eslint.stdout).toBe(alone.stdout);
    expect(oxlint.stdout).toBe(alone.stdout);
  });

  test("no ID or alias refers to more than one rule", async () => {
    const rules = await listRules();
    const names = rules.flatMap(it => [it.id, ...it.aliases]);
    expect(names.filter((name, at) => names.indexOf(name) !== at)).toEqual([]);
    expect(rules.filter(it => !it.modes.includes("native")).map(it => it.id)).toEqual([]);
    expect([...new Set(rules.map(it => it.kind))].sort()).toEqual(["layout", "problem", "suggestion", null].sort());
  });

  test("docs_url points to the rule's page in its plugin's directory", async () => {
    const rules = await listRules();
    const directories = Object.fromEntries(rules.map(it => [it.scope, it.docs_url.slice(base.length).split("/")[0]]));
    expect(directories).toEqual({
      "bun": "bun",
      "bun:test": "bun-test",
      "eslint": "eslint",
      "import": "import",
      "jest": "jest",
      "jsx_a11y": "jsx-a11y",
      "nextjs": "nextjs",
      "node": "node",
      "oxc": "oxc",
      "prettier": "prettier",
      "promise": "promise",
      "react": "react",
      "react_perf": "react-perf",
      "typescript": "typescript",
      "unicorn": "unicorn",
      "vitest": "vitest",
    });
    expect(rules.filter(it => it.docs_url !== `${base}${directories[it.scope]}/${it.value}`)).toEqual([]);
  });

  test("description matches the docs page's description", async () => {
    const rules = new Map((await listRules()).map(it => [it.docs_url.slice(base.length), it]));
    const written = pages().map(page => ({ page, description: frontmatter(page).description }));
    expect(written.length).toBeGreaterThan(1000);
    expect(written.map(({ page }) => ({ page, description: rules.get(page)?.description }))).toEqual(written);
  });

  test("on_by_default matches --print-config in a project without a config", async () => {
    const react = { "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }) };
    const [rules, ...printed] = await Promise.all([
      listRules(),
      ...["a.js", "a.jsx", "a.ts", "a.tsx"].map(file => lint(react, ["--print-config", file])),
    ]);
    const strongest: Record<string, number> = {};
    for (const { stdout } of printed) {
      for (const [id, [severity]] of Object.entries(JSON.parse(stdout).rules as Record<string, [number]>)) {
        strongest[id] = Math.max(strongest[id] ?? 0, severity);
      }
    }
    const on = Object.entries(strongest).filter(it => it[1] > 0);
    expect(on.length).toBeGreaterThan(70);
    expect(Object.fromEntries(rules.filter(it => it.on_by_default).map(it => [it.id, it.on_by_default]))).toEqual(
      Object.fromEntries(on.map(([id, severity]) => [id, severity === 2 ? "error" : "warn"])),
    );
    expect(strongest).toMatchObject({
      "no-debugger": 2,
      "react-hooks/rules-of-hooks": 2,
      "react-hooks/exhaustive-deps": 1,
    });
  });
});

describe.concurrent("--rules", () => {
  test("prints one rule per line into a pipe", async () => {
    const [{ stdout, stderr, exitCode }, rules] = await Promise.all([lint({}, ["--rules"]), listRules()]);
    expect(stdout).toBe(rules.map(it => `${it.scope}/${it.value}\n`).join(""));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("groups rules by plugin and adds descriptions in a terminal", async () => {
    const [{ output, exitCode }, rules] = await Promise.all([lintInTerminal(["--rules"]), listRules()]);
    const lines = output.split("\n");
    const count = (scope: string) => rules.filter(it => it.scope === scope).length;
    expect(lines.filter(line => /^\S.* rules?\)$/.test(line))).toEqual(
      [...new Set(rules.map(it => it.scope))].map(scope => {
        const directory = rules
          .find(it => it.scope === scope)!
          .docs_url.slice(base.length)
          .split("/")[0];
        return `${directory} (${count(scope)} ${count(scope) === 1 ? "rule" : "rules"})`;
      }),
    );
    const rows = lines.filter(line => line.startsWith("  "));
    expect(rows.map(row => row.slice(9).split(" ")[0])).toEqual(rules.map(it => it.id));
    expect(rows.map(row => row.slice(2, 9).trim() || false)).toEqual(rules.map(it => it.on_by_default));
    const described = (id: string) =>
      rows
        .find(row => row.slice(9).split(" ")[0] === id)!
        .slice(9 + id.length)
        .trim();
    expect(described("no-var")).toBe(frontmatter("eslint/no-var").description.replaceAll("`", ""));
    expect(lines.slice(-3)).toEqual([
      `${rules.length} rules. The ones marked error or warn are on by default.`,
      "Run bun lint --explain <rule> to read about a rule.",
      "",
    ]);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("--explain", () => {
  test("prints the rule's docs page", async () => {
    const { stdout, stderr, exitCode } = await lint({}, ["--explain", "eqeqeq"]);
    const { description } = frontmatter("eslint/eqeqeq");
    expect(stdout.split("\n").slice(0, 7)).toEqual([
      "eqeqeq",
      "======",
      "",
      description.replaceAll("`", ""),
      "",
      "Off by default, fixable. Also called eslint/eqeqeq.",
      "",
    ]);
    expect(stdout).toContain("\nExamples\n--------\n");
    expect(stdout).toContain(
      '\nConfigure\n---------\n\nOff by default. To turn it on:\n\nbunfig.toml\n\n+- toml\n| [lint.rules]\n| "eqeqeq" = "error" # or "warn"\n',
    );
    // A code block's file name goes above it.
    expect(stdout).toContain("\n\nbunfig.toml\n\n+- toml\n| [lint.rules]\n");
    expect(stdout).toEndWith(`\n${base}eslint/eqeqeq\n`);
    // Frontmatter and MDX comments are left out.
    expect(stdout).not.toContain("title:");
    expect(stdout).not.toContain("{/*");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("summarizes the default severity, fixability, aliases and related rules", async () => {
    const third = async (rule: string) =>
      (await lint({}, ["--explain", rule], { COLUMNS: "200" })).stdout.split("\n\n")[2];
    const rules = ["no-debugger", "prefer-const", "typescript/no-floating-promises", "no-unused-vars", "jest/no-hooks"];
    expect(await Promise.all(rules.map(third))).toEqual([
      "On by default as an error. Also called eslint/no-debugger.",
      "On by default as a warning, fixable. Also called eslint/prefer-const.",
      "Off by default, needs types. Also called typescript-eslint/no-floating-promises, typescript/no-floating-promises.",
      "On by default as a warning. Also called eslint/no-unused-vars. See also @typescript-eslint/no-unused-vars.",
      "Off by default. See also bun:test/no-hooks, vitest/no-hooks.",
    ]);
  });

  test("accepts a rule's ID and all of its aliases", async () => {
    const rules = await listRules();
    const names = ["@typescript-eslint/no-explicit-any", "react-hooks/rules-of-hooks", "@next/next/no-img-element"];
    for (const rule of rules.filter(it => names.includes(it.id))) {
      const printed = await Promise.all([rule.id, ...rule.aliases].map(name => lint({}, ["--explain", name])));
      expect(rule.aliases.length).toBeGreaterThan(0);
      expect(printed[0].stdout).toStartWith(rule.id + "\n");
      expect([...new Set(printed.map(it => it.stdout))]).toHaveLength(1);
    }
  });

  test("accepts a rule name without its plugin if only one rule has that name", async () => {
    const [short, long, several] = await Promise.all([
      lint({}, ["--explain", "no-floating-promises"]),
      lint({}, ["--explain", "@typescript-eslint/no-floating-promises"]),
      lint({}, ["--explain", "no-focused-tests"]),
    ]);
    expect(short).toEqual(long);
    expect(short.exitCode).toBe(0);
    expect(several).toEqual({
      stdout: "",
      stderr:
        'error: 3 rules are called "no-focused-tests"\n' +
        "  Choose one: bun:test/no-focused-tests, jest/no-focused-tests, vitest/no-focused-tests\n",
      exitCode: 2,
    });
  });

  test("an unknown rule is an error, with a suggestion", async () => {
    expect(await lint({}, ["--explain", "no-vra"])).toEqual({
      stdout: "",
      stderr: 'error: Unknown rule "no-vra"\n  Did you mean "no-var"?\n',
      exitCode: 2,
    });
    expect((await lint({}, ["--explain", "no-explicit-an"])).stderr).toMatch(
      /\n  Did you mean ".+\/no-explicit-any"\?\n$/,
    );
  });

  test("fails without a rule name", async () => {
    const { stdout, exitCode } = await lint({}, ["--explain"]);
    expect(stdout).toBe("");
    expect(exitCode).toBe(2);
  });

  test("reads no config and lints nothing", async () => {
    const files = { "eslint.config.js": "throw new Error('read');", ".oxlintrc.json": "{", "a.js": "debugger;" };
    const [here, alone] = await Promise.all([lint(files, ["--explain", "no-var"]), lint({}, ["--explain", "no-var"])]);
    expect(here).toEqual(alone);
    expect(here.exitCode).toBe(0);
  });

  test("works even if package.json has a `lint` script", async () => {
    const files = { "package.json": JSON.stringify({ scripts: { lint: "echo the script" } }) };
    const [one, other, alone] = await Promise.all([
      lint(files, ["--explain", "no-var"]),
      lint(files, ["--explain=no-var"]),
      lint({}, ["--explain", "no-var"]),
    ]);
    expect(one).toEqual(alone);
    expect(other).toEqual(alone);
  });

  test("wraps at the terminal width, and uses colors when they're on", async () => {
    const [narrow, colored] = await Promise.all([
      lint({}, ["--explain", "no-var"], { COLUMNS: "40" }),
      lint({}, ["--explain", "no-var"], { NO_COLOR: undefined, FORCE_COLOR: "1" }),
    ]);
    const prose = narrow.stdout.split("\n").filter(line => !/^[|+]/.test(line) && !line.startsWith(base));
    expect(Math.max(...prose.map(line => line.trimEnd().length))).toBeLessThanOrEqual(40);
    expect(colored.stdout).toContain("\x1b[1m");
    expect(Bun.stripANSI(colored.stdout)).toContain("no-var");
  });

  test.skipIf(isWindows)("the URL is a hyperlink in a terminal", async () => {
    const { output, exitCode } = await lintInTerminal(["--explain", "no-var"], { NO_COLOR: undefined });
    expect(output).toContain(`\x1b]8;;${base}eslint/no-var\x1b\\`);
    expect(exitCode).toBe(0);
    const listed = await lintInTerminal(["--rules"], { NO_COLOR: undefined });
    expect(listed.output).toContain(`\x1b]8;;${base}eslint/no-var\x1b\\no-var\x1b]8;;\x1b\\`);
  });
});
