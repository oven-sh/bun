import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  examplesOf,
  generatedFor,
  indexFor,
  pageNames,
  pageOf,
  pagesRoot,
  readPage,
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
  rules = JSON.parse((await lint(String(dir), ["--rules", "-f", "json"])).stdout);
  for (const rule of rules) byPage.set(pageOf(rule), rule);
});

const text = (page: string) => readFileSync(join(pagesRoot, page + ".mdx"), "utf8").replaceAll("\r\n", "\n");

describe("docs/lint/rules", () => {
  test("every rule has a page, and every page a rule", () => {
    expect(pageNames()).toEqual([...byPage.keys()].sort());
  });

  test("the frontmatter of every page is right", () => {
    const wrong: string[] = [];
    for (const [name, rule] of byPage) {
      const page = readPage(text(name));
      if (!page) wrong.push(`${name}: no frontmatter`);
      else if (page.title !== rule.id)
        wrong.push(`${name}: title is ${JSON.stringify(page.title)}, not ${JSON.stringify(rule.id)}`);
      else if (typeof page.description !== "string" || !/^[A-Z`].{0,109}(?<!\.)$/.test(page.description))
        wrong.push(`${name}: description is one line of at most 110 characters, with a capital first and no full stop`);
      else if (page.description !== rule.description) wrong.push(`${name}: --rules has another description: rebuild`);
      else if (page.generated !== generatedFor(rule))
        wrong.push(`${name}: run bun src/codegen/lint-rule-docs.ts --write`);
    }
    expect(wrong).toEqual([]);
  });

  test("index.mdx is up to date", () => {
    // bun src/codegen/lint-rule-docs.ts --write
    expect(readFileSync(join(pagesRoot, "index.mdx"), "utf8").replaceAll("\r\n", "\n")).toBe(indexFor(rules));
  });

  // Every example is a file of its own that ends with a comment that turns its rule on. One run lints those of a batch.
  const batches = Map.groupBy(pageNames(), name => name.split("/")[0])
    .entries()
    .flatMap(([plugin, names]) =>
      Array.from({ length: Math.ceil(names.length / 20) }, (_, i) => {
        const part = names.slice(i * 20, i * 20 + 20);
        return [`${plugin}: ${part[0].split("/")[1]} to ${part.at(-1)!.split("/")[1]}`, part] as const;
      }),
    )
    .toArray();
  test.concurrent.each(batches)(
    "what a page says is reported is reported, and the rest is not: %s",
    async (_, names) => {
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
        // `**\/*.js`: a `*` and a `/` in a pattern would end the comment.
        const setting = JSON.stringify(["error", ...it.options]).replaceAll("*/", "*\\/");
        put(join(directoryOf(it), it.filename), `${it.code}\n/* eslint ${rule.id}: ${setting} */\n`);
        if (!rule.type_aware) continue;
        const compilerOptions = {
          strict: true,
          noEmit: true,
          target: "esnext",
          module: "esnext",
          moduleResolution: "bundler",
          jsx: "preserve",
          lib: ["esnext", "dom"],
          skipLibCheck: true,
          ...it.compilerOptions,
        };
        put(join(directoryOf(it), "tsconfig.json"), JSON.stringify({ compilerOptions, include: ["."] }));
      }

      // All at once, those that need types apart. An example that is a project of its own has a run of its own.
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
          throw new Error(`no report: ${stderr.slice(0, 2000)}`);
        }
        const byFile = new Map(report.map(it => [it.filePath, it.messages]));
        for (const it of part) {
          const rule = byPage.get(it.page)!;
          const where = `${it.page}: line ${it.line}${it.options.length ? ` with ${JSON.stringify(it.options)}` : ""}`;
          const messages = byFile.get(join(directoryOf(it), it.filename));
          const own =
            messages?.filter(message => message.ruleId === rule.id || rule.aliases.includes(message.ruleId!)) ?? [];
          // Options that are refused are reported in the name of the rule.
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
      // A rule that reports only beside a configuration of oxlint.
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
    },
  );
});
