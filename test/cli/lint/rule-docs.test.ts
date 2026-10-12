import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  bodyFor,
  configFor,
  examplesOf,
  generatedFor,
  indexFor,
  pageNames,
  pageOf,
  pagesRoot,
  readPage,
  readRules,
  writtenPart,
  type Example,
  type Rule,
} from "../../../src/codegen/lint-rule-docs.ts";

const env = { ...bunEnv, NO_COLOR: "1", AGENT: "0", CLAUDECODE: undefined, CI: undefined, GITHUB_ACTIONS: undefined };

async function lint(cwd: string, args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "lint", ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

let rules: Rule[] = [];
const byPage = new Map<string, Rule>();
beforeAll(async () => {
  using dir = tempDir("bun-lint-rule-docs", { "package.json": "{}" });
  rules = readRules((await lint(String(dir), ["--rules", "-f", "json"])).stdout);
  for (const rule of rules) byPage.set(pageOf(rule), rule);
});

/** `compilerOptions` for the examples of rules that need types. */
const typed = {
  strict: true,
  noEmit: true,
  target: "esnext",
  module: "esnext",
  moduleResolution: "bundler",
  jsx: "preserve",
  lib: ["esnext", "dom"],
  skipLibCheck: true,
};

const text = (page: string) => readFileSync(join(pagesRoot, page + ".mdx"), "utf8").replaceAll("\r\n", "\n");

describe("docs/lint/rules", () => {
  test("every rule has a page and every page has a rule", () => {
    expect(pageNames()).toEqual([...byPage.keys()].sort());
  });

  test("frontmatter is valid and up to date", () => {
    const wrong: string[] = [];
    for (const [name, rule] of byPage) {
      const page = readPage(text(name));
      if (!page) wrong.push(`${name}: no frontmatter`);
      else if (page.title !== rule.id)
        wrong.push(`${name}: title is ${JSON.stringify(page.title)}, not ${JSON.stringify(rule.id)}`);
      else if (typeof page.description !== "string" || !/^[A-Z`].{0,109}(?<!\.)$/.test(page.description))
        wrong.push(
          `${name}: description must be one line, at most 110 characters, capitalized, with no trailing period`,
        );
      else if (page.description !== rule.description)
        wrong.push(`${name}: description differs from \`bun lint --rules\`. Rebuild bun.`);
      else if (page.generated !== generatedFor(rule))
        wrong.push(`${name}: stale frontmatter. Run bun src/codegen/lint-rule-docs.ts --write`);
    }
    expect(wrong).toEqual([]);
  });

  test("TOML snippets are formatted the way `bun format` prints them", async () => {
    // Pasting a snippet into a formatted bunfig.toml has to keep `bun format --check` green.
    const files: Record<string, string> = { "canary/bunfig.toml": "a   = 1\n" };
    for (const name of pageNames()) {
      let count = 0;
      for (const [, code] of text(name).matchAll(/^```toml[^\n]*\n(.*?)^```/gms))
        files[`${name.replaceAll("/", "__")}__${count++}/bunfig.toml`] = code;
    }
    expect(Object.keys(files).length).toBeGreaterThan(1000);
    using dir = tempDir("bun-lint-rule-docs-toml", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "format", "--list-different", "."],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // The canary shows that TOML files were looked at.
    expect(stdout.replaceAll("\\", "/").split("\n").filter(Boolean)).toEqual(["canary/bunfig.toml"]);
  });

  test("index.mdx is up to date", () => {
    // bun src/codegen/lint-rule-docs.ts --write
    expect(readFileSync(join(pagesRoot, "index.mdx"), "utf8").replaceAll("\r\n", "\n")).toBe(indexFor(rules));
  });

  test("the Configure section is up to date", () => {
    // bun src/codegen/lint-rule-docs.ts --write
    const stale = [...byPage].filter(([name, rule]) => {
      const page = readPage(text(name));
      return page && page.body !== bodyFor(rule, page.body);
    });
    expect(stale.map(([name]) => name)).toEqual([]);
  });

  test("snippets fit an 80-column terminal", () => {
    const lines = [...byPage].flatMap(([name, rule]) => {
      const config = configFor(rule, writtenPart(readPage(text(name))!.body));
      return [...(config?.toggle ?? []), ...(config?.defaults?.lines ?? [])];
    });
    // `--explain` draws a frame to the left of the code.
    expect(lines.filter(line => line.length > 78)).toEqual([]);
  });

  test("snippets that turn a rule off work", async () => {
    // A rule that never reports has no Configure section.
    const config = (rule: Rule) => configFor(rule, writtenPart(readPage(text(pageOf(rule)))!.body));
    const on = rules.filter(rule => rule.on_by_default && config(rule));
    const toggles = on.flatMap(rule => config(rule)!.toggle);
    expect(toggles.length).toBeGreaterThan(70);
    using dir = tempDir("bun-lint-rule-docs", {
      "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }),
      "bunfig.toml": `[lint.rules]\n${toggles.join("\n")}\n`,
    });
    for (const file of ["a.js", "a.tsx"]) {
      const { stdout, stderr } = await lint(String(dir), ["--print-config", file]);
      expect(stderr).toBe("");
      const printed: Record<string, [number]> = JSON.parse(stdout).rules;
      expect(on.filter(rule => printed[rule.id]?.[0]).map(rule => rule.id)).toEqual([]);
    }
  });

  // Each example becomes its own file, with a trailing `/* eslint rule: ... */` comment that enables the rule.
  // One `bun lint` run covers a whole batch.
  const batches = Map.groupBy(pageNames(), name => name.split("/")[0])
    .entries()
    .flatMap(([plugin, names]) =>
      Array.from({ length: Math.ceil(names.length / 20) }, (_, i) => {
        const part = names.slice(i * 20, i * 20 + 20);
        return [`${plugin}: ${part[0].split("/")[1]} to ${part.at(-1)!.split("/")[1]}`, part] as const;
      }),
    )
    .toArray();
  test.concurrent.each(batches)("examples behave as marked: %s", async (_, names) => {
    const wrong: string[] = [];
    const examples: Example[] = [];
    for (const name of names) {
      if (!byPage.has(name)) continue;
      const page = readPage(text(name));
      if (!page) continue;
      const firstLine = text(name).length
        ? text(name)
            .slice(0, text(name).length - page.body.length)
            .split("\n").length
        : 1;
      const found = examplesOf(name, page.body, firstLine);
      wrong.push(...found.problems.map(it => `${name}: ${it}`));
      examples.push(...found.examples);
    }

    using dir = tempDir("bun-lint-rule-docs", {
      "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }),
    });
    const directoryOf = (it: Example) => join(String(dir), `${it.page.replaceAll("/", "__")}__${it.line}`);
    const put = (path: string, content: string) => (
      mkdirSync(dirname(path), { recursive: true }),
      writeFileSync(path, content)
    );
    for (const it of examples) {
      const rule = byPage.get(it.page)!;
      for (const [name, content] of Object.entries(it.files)) put(join(directoryOf(it), name), content);
      for (const [name, version] of Object.entries(it.packages ?? {}))
        put(join(directoryOf(it), "node_modules", name, "package.json"), JSON.stringify({ name, version }));
      // Escape `*/` in options like `**/*.js`, or it would close the comment.
      const setting = JSON.stringify(["error", ...it.options]).replaceAll("*/", "*\\/");
      put(join(directoryOf(it), it.filename), `${it.code}\n/* eslint ${rule.id}: ${setting} */\n`);
      if (!rule.type_aware) continue;
      const compilerOptions = { ...typed, ...it.compilerOptions };
      put(join(directoryOf(it), "tsconfig.json"), JSON.stringify({ compilerOptions, include: ["."] }));
    }

    // Two runs for most examples: one without types, one with. Each `root` example gets its own run.
    const native = examples.filter(it => it.config !== "oxlint");
    const together = native.filter(it => !it.root);
    const runs = [
      ...[false, true].map(typed => ({
        cwd: String(dir),
        typed,
        part: together.filter(it => byPage.get(it.page)!.type_aware === typed),
      })),
      ...native
        .filter(it => it.root)
        .map(it => ({ cwd: directoryOf(it), typed: byPage.get(it.page)!.type_aware, part: [it] })),
    ];
    for (const it of examples)
      if (it.root && !it.files["package.json"]) put(join(directoryOf(it), "package.json"), "{}");
    for (const { cwd, typed, part } of runs) {
      const paths = part.map(it => directoryOf(it).slice(cwd.length + 1) || ".");
      const { stdout, stderr } = await lint(cwd, ["-f", "json", ...(typed ? ["--type-aware"] : []), ...paths]);
      let report: {
        filePath: string;
        messages: { ruleId: string | null; fatal?: boolean; message: string; line: number }[];
      }[];
      try {
        report = JSON.parse(stdout);
      } catch {
        throw new Error(`bun lint printed no JSON: ${stderr.slice(0, 2000)}`);
      }
      const byFile = new Map(report.map(it => [it.filePath, it.messages]));
      for (const it of part) {
        const rule = byPage.get(it.page)!;
        const where = `${it.page}: line ${it.line}${it.options.length ? ` with ${JSON.stringify(it.options)}` : ""}`;
        const messages = byFile.get(join(directoryOf(it), it.filename));
        const ids = [rule.id, ...rule.aliases, rule.twin?.id];
        const own = messages?.filter(message => ids.includes(message.ruleId!)) ?? [];
        // Invalid options are reported under the rule's own ID, so don't count that as a real report.
        const fatal =
          messages?.find(message => message.fatal) ??
          own.find(message => message.message.startsWith("Inline configuration for rule"));
        if (!messages) wrong.push(`${where}: ${it.filename} was not linted`);
        else if (fatal) wrong.push(`${where}: ${fatal.message}`);
        else if (it.want === "good" && own.length) wrong.push(`${where}: reported: ${own[0].message}`);
        else if (it.want === "bad" && !own.length) wrong.push(`${where}: not reported`);
        else if (it.count !== undefined && own.length !== it.count)
          wrong.push(`${where}: ${own.length} reports, not ${it.count}`);
      }
    }
    // Rules that only report with an oxlint config.
    for (const it of examples.filter(it => it.config === "oxlint")) {
      const rule = byPage.get(it.page)!;
      const name = `${rule.scope.replaceAll("_", "-")}/${rule.value}`;
      const plugins = [
        "typescript",
        "unicorn",
        "oxc",
        "react",
        "react-perf",
        "import",
        "jsx-a11y",
        "nextjs",
        "promise",
        "node",
        "jest",
        "vitest",
      ];
      put(join(directoryOf(it), "package.json"), "{}");
      put(join(directoryOf(it), it.filename), it.code);
      put(
        join(directoryOf(it), ".oxlintrc.json"),
        JSON.stringify({
          plugins,
          categories: { correctness: "off" },
          settings: it.settings ?? {},
          rules: { [name]: ["error", ...it.options] },
        }),
      );
      const { stdout, stderr, exitCode } = await lint(directoryOf(it), ["-f", "unix", "."]);
      const reports = stdout.split("\n").filter(line => /\[(Error|Warning)\/[^\]]+\]$/.test(line)).length;
      const where = `${it.page}: line ${it.line}, with an oxlint config`;
      if (exitCode === 2) wrong.push(`${where}: ${stderr.slice(0, 300)}`);
      else if (it.want === "good" && reports) wrong.push(`${where}: reported`);
      else if (it.want === "bad" && !reports) wrong.push(`${where}: not reported`);
      else if (it.count !== undefined && reports !== it.count)
        wrong.push(`${where}: ${reports} reports, not ${it.count}`);
    }
    expect(wrong).toEqual([]);
  });

  // Lints every example in the batch twice: with each rule just turned on, then with each rule's options snippet.
  // The snippets claim to set every option to its default, so both runs must report the same.
  test.concurrent.each(batches)("snippets load, and the defaults in them are real: %s", async (_, names) => {
    using dir = tempDir("bun-lint-rule-docs", {
      "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }),
    });
    const put = (path: string, content: string) => (
      mkdirSync(dirname(join(String(dir), path)), { recursive: true }),
      writeFileSync(join(String(dir), path), content)
    );
    const wrong: string[] = [];
    const [plain, withOptions]: string[][] = [[], []];
    for (const name of names) {
      const rule = byPage.get(name);
      const page = readPage(text(name));
      if (!rule || !page) continue;
      const written = writtenPart(page.body);
      for (const it of examplesOf(name, written, 1).examples) {
        const directory = `${name.replaceAll("/", "__")}__${it.line}`;
        // bunfig.toml is the config here.
        for (const [file, content] of Object.entries(it.files))
          if (!/(^|\/)(eslint\.config\.|\.eslintrc)/.test(file)) put(`${directory}/${file}`, content);
        put(`${directory}/${it.filename}`, it.code);
        if (rule.type_aware)
          put(
            `${directory}/tsconfig.json`,
            JSON.stringify({ compilerOptions: { ...typed, ...it.compilerOptions }, include: ["."] }),
          );
      }
      const config = configFor(rule, written);
      if (!config) continue;
      const id = JSON.stringify(rule.id);
      const on = rule.on_by_default ? [`${id} = "${rule.on_by_default}"`] : config.toggle;
      // This rule does nothing until it gets an options object. Its page says so.
      plain.push(...(rule.id === "react/boolean-prop-naming" ? [`${id} = ["error", {}]`] : on));
      withOptions.push(...(config.defaults?.lines ?? on));
      if (!config.defaults) continue;
      const parsed: any = Bun.TOML.parse(`[lint.rules]\n${config.defaults.lines.join("\n")}\n`);
      if (!Bun.deepEquals(parsed.lint.rules[rule.id].slice(1), config.defaults.options))
        wrong.push(`${name}: the snippet sets ${JSON.stringify(parsed.lint.rules[rule.id].slice(1))}`);
    }

    const run = async (lines: string[]) => {
      put("bunfig.toml", `[lint.rules]\n${lines.join("\n")}\n`);
      const { stdout, stderr } = await lint(String(dir), ["-f", "json", "."]);
      try {
        const report: { filePath: string; messages: { ruleId: string | null }[] }[] = JSON.parse(stdout);
        return new Map(report.map(it => [it.filePath, it.messages]));
      } catch {
        throw new Error(`bun lint printed no JSON: ${stderr.slice(0, 2000)}`);
      }
    };
    const before = await run(plain);
    expect(before.size).toBeGreaterThan(0);
    if (withOptions.join() !== plain.join()) {
      for (const [file, messages] of await run(withOptions)) {
        const of = (list: typeof messages, id: string | null) => JSON.stringify(list.filter(it => it.ruleId === id));
        for (const id of new Set([...messages, ...before.get(file)!].map(it => it.ruleId)))
          if (of(messages, id) !== of(before.get(file)!, id))
            wrong.push(`${id}: reports change with the options snippet in ${file.slice(String(dir).length + 1)}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
