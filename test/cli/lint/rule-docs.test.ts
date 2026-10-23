import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  FILES,
  bodyFor,
  configFor,
  examplesIn,
  examplesOf,
  generatedFor,
  indexFor,
  lintExamples,
  pageNames,
  pageOf,
  pagesRoot,
  readPage,
  readRules,
  reportsOf,
  typed,
  writtenPart,
  type Example,
  type Reports,
  type Rule,
} from "../../../src/codegen/lint-rule-docs.ts";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = { ...bunEnv, NO_COLOR: "1", AGENT: "0", CLAUDECODE: undefined, CI: undefined, GITHUB_ACTIONS: undefined };

async function lint(cwd: string, args: string[], config?: string) {
  await using proc = spawn({
    cmd: [bunExe(), ...(config ? [`--config=${config}`] : []), "lint", ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
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

const recorded: Reports = JSON.parse(readFileSync(join(pagesRoot, "reports.json"), "utf8"));

const text = (page: string) => readFileSync(join(pagesRoot, page + ".mdx"), "utf8").replaceAll("\r\n", "\n");

describe("docs/lint/rules", () => {
  test("every rule has a page and every page has a rule", () => {
    expect(pageNames()).toEqual([...byPage.keys()].sort());
    expect(Object.keys(recorded).filter(page => !byPage.has(page))).toEqual([]);
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

  test("TOML snippets are formatted the way `bun fmt` prints them", async () => {
    // Pasting a snippet into a formatted bunfig.toml has to keep `bun fmt --check` green.
    const files: Record<string, string> = { "canary/bunfig.toml": "a   = 1\n" };
    for (const name of pageNames()) {
      let count = 0;
      for (const [, code] of text(name).matchAll(/^```toml[^\n]*\n(.*?)^```/gms))
        files[`${name.replaceAll("/", "__")}__${count++}/bunfig.toml`] = code;
    }
    expect(Object.keys(files).length).toBeGreaterThan(1000);
    using dir = tempDir("bun-lint-rule-docs-toml", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fmt", "--list-different", "."],
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

  // Each typed example builds its own TypeScript program, not just its own source file.
  const byExamples = (names: string[]) => {
    const parts: string[][] = [];
    let count = 0;
    for (const name of names) {
      const size = examplesIn(name, text(name))?.examples.length ?? 0;
      if (!parts.length || count + size > 10) {
        parts.push([]);
        count = 0;
      }
      parts.at(-1)!.push(name);
      count += size;
    }
    return parts;
  };

  // Each example becomes its own file, with a trailing `/* eslint rule: ... */` comment that enables the rule.
  const batches = Map.groupBy(pageNames(), name => name.split("/")[0])
    .entries()
    .flatMap(([plugin, names]) =>
      Array.from({ length: Math.ceil(names.length / 20) }, (_, i) => names.slice(i * 20, i * 20 + 20))
        .flatMap(part => (plugin === "typescript" ? byExamples(part) : [part]))
        .map(part => [`${plugin}: ${part[0].split("/")[1]} to ${part.at(-1)!.split("/")[1]}`, part] as const),
    )
    .toArray();
  test.concurrent.each(batches)("examples behave as marked: %s", async (_, names) => {
    const wrong: string[] = [];
    const examples: Example[] = [];
    for (const name of names) {
      if (!byPage.has(name)) continue;
      const found = examplesIn(name, text(name));
      if (!found) continue;
      wrong.push(...found.problems.map(it => `${name}: ${it}`));
      examples.push(...found.examples);
    }

    using dir = tempDir("bun-lint-rule-docs", {});
    const outcomes = await lintExamples(String(dir), examples, byPage, lint);
    for (const it of examples) {
      const { reports, error } = outcomes.get(it)!;
      const configNote = it.config === "oxlint" ? ", with an oxlint config" : "";
      const where = `${it.page}: line ${it.line}${it.options.length ? ` with ${JSON.stringify(it.options)}` : ""}${configNote}`;
      if (error) wrong.push(`${where}: ${error}`);
      else if (it.want === "good" && reports.length) wrong.push(`${where}: reported: ${reports[0][4]}`);
      else if (it.want === "bad" && !reports.length) wrong.push(`${where}: not reported`);
      else if (it.count !== undefined && reports.length !== it.count)
        wrong.push(`${where}: ${reports.length} reports, not ${it.count}`);
    }

    // The website underlines these in the examples.
    const now = reportsOf(examples, outcomes);
    for (const name of names)
      if (!Bun.deepEquals(recorded[name], now[name]))
        wrong.push(`${name}: reports.json is out of date. Run \`bun src/codegen/lint-rule-docs.ts --write\`.`);
    expect(wrong).toEqual([]);
  });

  test.concurrent("reports.json is the same on Windows, where a path in a message has backslashes", async () => {
    const names = ["import/no-relative-packages", "import/named", "eslint/no-useless-escape"];
    const examples = names.flatMap(name => examplesIn(name, text(name))!.examples);
    using dir = tempDir("bun-lint-rule-docs", {});
    const asOnWindows = async (cwd: string, args: string[]) => {
      const { stdout, ...rest } = await lint(cwd, args);
      const native = stdout
        .replaceAll("@acme/ui/button.js", String.raw`@acme\\ui\\button.js`)
        .replaceAll("'./dates.js'", String.raw`'.\\dates.js'`);
      return { ...rest, stdout: native };
    };
    const now = reportsOf(examples, await lintExamples(String(dir), examples, byPage, asOnWindows));
    expect(JSON.stringify(recorded["import/no-relative-packages"])).toContain("@acme/ui/button.js");
    expect(JSON.stringify(recorded["import/named"])).toContain("'./dates.js'");
    // In the other rule's messages a backslash is part of what they say.
    expect(JSON.stringify(recorded["eslint/no-useless-escape"])).toContain(String.raw`character: \\d.`);
    for (const name of names) expect(now[name]).toEqual(recorded[name]);
  });

  const needsTypes = (name: string) => readPage(text(name))?.generated.split("\n").includes("typeAware: true") ?? false;
  // bunfig.toml can't turn on a rule for another language or for Svelte components, so those pages have no bunfig.toml
  // snippets.
  const otherLanguages = new Set([...Object.keys(FILES).map(language => language.split("/")[0]), "svelte"]);
  const withSnippets = batches.filter(([, names]) => !otherLanguages.has(names[0].split("/")[0]));
  const snippetBatches = withSnippets
    .flatMap(([name, names]) => {
      if (!name.startsWith("typescript:")) return [[name, names] as const];
      // A typed rule would otherwise make the syntax-only examples build TypeScript programs too.
      return Array.from(
        Map.groupBy(names, needsTypes).values(),
        part => [`typescript: ${part[0].split("/")[1]} to ${part.at(-1)!.split("/")[1]}`, part] as const,
      );
    })
    .flatMap(([name, names]) => {
      if (!name.startsWith("typescript:") || !needsTypes(names[0])) return [[name, names, 0, Infinity] as const];
      const count = names.reduce((count, name) => {
        const page = readPage(text(name));
        return count + (page ? examplesOf(name, writtenPart(page.body), 1).examples.length : 0);
      }, 0);
      return Array.from({ length: Math.max(1, Math.ceil(count / 3)) }, (_, i) => {
        const start = i * 3;
        const title: string = `${name} (examples ${start + 1}-${Math.min(count, start + 3)})`;
        return [title, names, start, start + 3] as const;
      });
    });

  // Lints every example in the batch twice: with each rule just turned on, and with each rule's options snippet.
  // The snippets claim to set every option to its default, so both runs must report the same.
  test.concurrent.each(snippetBatches)(
    "snippets load, and the defaults in them are real: %s",
    async (_, names, start, end) => {
      using dir = tempDir("bun-lint-rule-docs", {
        "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }),
      });
      const put = (path: string, content: string) => (
        mkdirSync(dirname(join(String(dir), path)), { recursive: true }),
        writeFileSync(join(String(dir), path), content)
      );
      const wrong: string[] = [];
      const files: Record<string, string> = {};
      const [plain, withOptions]: string[][] = [[], []];
      let index = 0;
      for (const name of names) {
        const rule = byPage.get(name);
        const page = readPage(text(name));
        if (!rule || !page) continue;
        const written = writtenPart(page.body);
        for (const it of examplesOf(name, written, 1).examples) {
          const at = index++;
          if (at < start || at >= end) continue;
          const directory = `${name.replaceAll("/", "__")}__${it.line}`;
          // bunfig.toml is the config here.
          for (const [file, content] of Object.entries(it.files))
            if (!/(^|\/)(eslint\.config\.|\.eslintrc)/.test(file)) files[`${directory}/${file}`] = content;
          files[`${directory}/${it.filename}`] = it.code;
          if (rule.type_aware)
            files[`${directory}/tsconfig.json`] = JSON.stringify({
              compilerOptions: { ...typed, ...it.compilerOptions },
              include: ["."],
            });
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

      const compare = withOptions.join() !== plain.join();
      // Share type-checker startup without sharing a program between the two copies of an example.
      const together = compare && names[0].startsWith("typescript/") && needsTypes(names[0]);
      for (const [file, content] of Object.entries(files)) {
        put(file, content);
        if (together) put(`with-options/${file}`, content);
      }
      const run = async (lines: string[], overrides?: string[], file?: string) => {
        let config = `[lint.rules]\n${lines.join("\n")}\n`;
        if (overrides)
          config += `\n[[lint.overrides]]\nfiles = ["with-options/**"]\n[lint.overrides.rules]\n${overrides.join("\n")}\n`;
        put(file ?? "bunfig.toml", config);
        // The tests already run concurrently; each child must not start a host-sized pool too.
        const { stdout, stderr } = await lint(String(dir), ["-f", "json", "--threads", "1", "."], file);
        try {
          const report: { filePath: string; messages: { ruleId: string | null }[] }[] = JSON.parse(stdout);
          return new Map(report.map(it => [relative(String(dir), it.filePath).replaceAll("\\", "/"), it.messages]));
        } catch {
          throw new Error(`bun lint printed no JSON: ${stderr.slice(0, 2000)}`);
        }
      };
      // Separate configs let both startups overlap without moving path-sensitive import fixtures.
      const [reports, separate] = await Promise.all([
        run(plain, together ? withOptions : undefined),
        compare && !together ? run(withOptions, undefined, "with-options.toml") : undefined,
      ]);
      const before = new Map([...reports].filter(([file]) => !file.startsWith("with-options/")));
      expect(before.size).toBeGreaterThan(0);
      if (compare) {
        const after = together
          ? new Map(
              [...reports]
                .filter(([file]) => file.startsWith("with-options/"))
                .map(([file, messages]) => [file.slice("with-options/".length), messages]),
            )
          : separate!;
        expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
        for (const [file, messages] of after) {
          const of = (list: typeof messages, id: string | null) => JSON.stringify(list.filter(it => it.ruleId === id));
          for (const id of new Set([...messages, ...before.get(file)!].map(it => it.ruleId)))
            if (of(messages, id) !== of(before.get(file)!, id))
              wrong.push(`${id}: reports change with the options snippet in ${file}`);
        }
      }
      expect(wrong).toEqual([]);
    },
  );
});
