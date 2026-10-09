// What eslint-plugin-react-hooks reports with its rules of the React Compiler in the repositories of ../repos: all of these rules,
// over all files of a repository, with one configuration. Nothing of a repository's own configuration is read or run.
//
//   sudo bun repos-eslint.ts --work=<work of ../repos/run.ts> --out=<jsonl> --modules=<node_modules> --only=owner/repo,..
//                            [--runs=<directory>] [--concurrency=4] [--cpus=0-7] [--seconds=1800] [--memory-kb=8000000]
//   sudo bun repos-eslint.ts --work=.. --out=<jsonl> --files-of=<jsonl of the first form> --tool="<path> <arguments>" [..]
//
// <node_modules> has eslint, eslint-plugin-react-hooks and @typescript-eslint/parser. The clones are those of
// `../repos/run.ts --stages=clone`. Each command runs in its sandbox, in a copy of the clone, from its root.
//
// The output of the first form: a line {"repo", "files", "exit", "seconds", "cpu", "rssMb"} for each repository, then a line as of
// eslint.ts for EACH file that was linted; the path starts with `owner__repo/`, in the messages too.
//
// The second form gives the same files to another tool, as arguments after its own, and keeps the lines that it prints, which have
// a "path": the name of the repository is put in front of it.

import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ownDirectory, sandboxed, type Limits } from "../repos/sandbox.ts";
import type { EslintRecord, Message } from "./eslint.ts";
import { jsonDocuments, JsonlWriter, options, table } from "./shared.ts";

const { flags } = options(process.argv.slice(2));
if (!flags.has("work") || !flags.has("out") || !(flags.has("modules") || flags.has("tool"))) {
  throw new Error(
    "usage: bun repos-eslint.ts --work=<directory> --out=<jsonl> --modules=<node_modules> --only=owner/repo,..",
  );
}
const work = realpathSync(flags.get("work")!);
const allRuns = resolve(flags.get("runs") ?? join(work, ".runs"));
const tool = flags.get("tool")?.split(" ") ?? null;
const modules = flags.has("modules") ? realpathSync(flags.get("modules")!) : null;
const limits: Limits = {
  cpus: flags.get("cpus") ?? null,
  memoryKb: Number(flags.get("memory-kb") ?? 8_000_000),
  seconds: Number(flags.get("seconds") ?? 1800),
};
const nameOf = (repo: string) => repo.replace("/", "__");
const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

const CONFIG = (from: string) => `import { createRequire } from "node:module";
const require = createRequire(${JSON.stringify(join(from, "x.js"))});
const plugin = require("eslint-plugin-react-hooks");
const names = Object.keys(plugin.rules).filter(rule => rule !== "rules-of-hooks" && rule !== "exhaustive-deps");
export default [
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx}"],
    plugins: { "react-hooks": plugin },
    rules: Object.fromEntries(names.map(rule => ["react-hooks/" + rule, "error"])),
    languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  { files: ["**/*.{ts,tsx}"], languageOptions: { parser: require("@typescript-eslint/parser") } },
];
`;
// Without the text of the files, and without what ESLint says of comments that name rules it does not know.
const FORMATTER = `module.exports = results =>
  JSON.stringify(
    results.map(({ filePath, messages, suppressedMessages }) => ({
      filePath,
      messages: messages.filter(it => it.fatal || (it.ruleId ?? "").startsWith("react-hooks/")),
      suppressedMessages: suppressedMessages.filter(it => (it.ruleId ?? "").startsWith("react-hooks/")),
    })),
  );
`;

type Outcome = { code: number; stdout: string; stderr: string; seconds: number; cpu: number; rssMb: number };

/** One command in a copy of the repository, which sees `given` as files of a directory. What it writes is thrown away. */
async function inCopy(
  repo: string,
  given: Record<string, string>,
  cmd: (directory: string) => string[],
): Promise<Outcome> {
  const runs = join(allRuns, nameOf(repo));
  const base = join(runs, `react-compiler-eslint-${process.pid}`);
  const [upper, scratch, out, input] = ["upper", "work", "out", "input"].map(name => ownDirectory(join(base, name)));
  for (const [name, text] of Object.entries(given)) writeFileSync(join(input, name), text);
  const clone = join(work, nameOf(repo));
  const code = await sandboxed({
    cmd: cmd(input),
    cwd: clone,
    ro: [input, ...(modules ? [modules] : []), ...(tool ? [dirname(realpathSync(tool[0]))] : [])],
    rw: [out],
    overlay: { lower: clone, upper, work: scratch },
    stdout: join(out, "stdout"),
    stderr: join(out, "stderr"),
    time: join(out, "time"),
    limits,
  });
  const [seconds, user, system, rss] = (read(join(out, "time")).trim().split("\n").at(-1) ?? "").split(" ").map(Number);
  const outcome = {
    code,
    stdout: read(join(out, "stdout")),
    stderr: read(join(out, "stderr")),
    seconds,
    cpu: Math.round((user + system) * 100) / 100,
    rssMb: Math.round(rss / 1024),
  };
  if (!realpathSync(base).startsWith(realpathSync(runs) + "/react-compiler-eslint-")) {
    throw new Error(`not a directory of this script: ${base}`);
  }
  rmSync(base, { recursive: true, force: true });
  return outcome;
}

const plain = (raw: Message, root: string): Message => ({
  ruleId: raw.ruleId,
  severity: raw.severity,
  message: raw.message.replaceAll(`${root}/`, ""),
  line: raw.line,
  column: raw.column,
  endLine: raw.endLine,
  endColumn: raw.endColumn,
  suggestions: raw.suggestions?.map(({ desc, fix }) => ({ desc, fix: { range: fix.range, text: fix.text } })),
});

const writer = new JsonlWriter(resolve(flags.get("out")!));
const rows: (string | number)[][] = [];

if (tool === null) {
  for (const repo of (flags.get("only") ?? "").split(",").filter(Boolean)) {
    const clone = join(work, nameOf(repo));
    if (!existsSync(join(clone, ".git"))) continue;
    // A link to nothing ends the whole run: it is left out, and the run starts again.
    const ignored: string[] = [];
    let result: Outcome;
    for (;;) {
      result = await inCopy(repo, { "eslint.config.mjs": CONFIG(modules!), "formatter.cjs": FORMATTER }, input => [
        "node",
        join(modules!, "eslint", "bin", "eslint.js"),
        ...["-c", join(input, "eslint.config.mjs"), "-f", join(input, "formatter.cjs")],
        ...ignored.flatMap(path => ["--ignore-pattern", path]),
        ...["--concurrency", flags.get("concurrency") ?? "4", "."],
      ]);
      const missing = /ENOENT: no such file or directory, open '([^']+)'/.exec(result.stderr)?.[1];
      if (missing === undefined || !missing.startsWith(`${clone}/`) || ignored.length === 20) break;
      ignored.push(missing.slice(clone.length + 1));
    }
    const { code: exit, seconds, cpu, rssMb } = result;
    if (!result.stdout.startsWith("[")) {
      writer.write({ repo, exit, seconds, cpu, rssMb, failed: (result.stderr + result.stdout).slice(0, 1500) });
      rows.push([repo, "no report", 0, 0, 0, seconds || 0, cpu || 0, rssMb || 0]);
      continue;
    }
    type Raw = { filePath: string; messages: (Message & { fatal?: boolean })[]; suppressedMessages: Message[] };
    const report = (JSON.parse(result.stdout) as Raw[]).sort((a, b) => (a.filePath < b.filePath ? -1 : 1));
    writer.write({ repo, exit, files: report.length, seconds, cpu, rssMb });
    let messages = 0;
    let refused = 0;
    for (const file of report) {
      const isRefused = file.messages.some(message => message.fatal);
      if (isRefused) refused++;
      else messages += file.messages.length;
      writer.write({
        path: `${nameOf(repo)}/${file.filePath.slice(clone.length + 1)}`,
        parse: isRefused ? "error" : "ok",
        messages: file.messages.map(message => plain(message, work)),
        suppressed: file.suppressedMessages.map(message => plain(message, work)),
      } satisfies EslintRecord);
    }
    rows.push([repo, String(exit), report.length, refused, messages, seconds, cpu, rssMb]);
  }
  writer.close();
  console.log(
    table(
      ["Repository", "Exit", "Files", "Refused by the parser", "Messages", "Wall (s)", "CPU (s)", "Max RSS (MB)"],
      rows,
    ),
  );
} else {
  const files = new Map<string, string[]>();
  const repositories: string[] = [];
  for (const document of jsonDocuments(readFileSync(flags.get("files-of")!, "utf8"))) {
    const line = document as { repo?: string; failed?: string; path?: string };
    if (line.repo !== undefined && line.failed === undefined) repositories.push(line.repo);
    if (line.path === undefined) continue;
    const at = line.path.indexOf("/");
    const list = files.get(line.path.slice(0, at)) ?? [];
    files.set(line.path.slice(0, at), list);
    list.push(line.path.slice(at + 1));
  }
  for (const repo of repositories) {
    const list = files.get(nameOf(repo)) ?? [];
    const result = await inCopy(repo, { files: list.join("\0") + "\0" }, input => [
      ...["xargs", "-0", "-a", join(input, "files")],
      ...tool,
    ]);
    const { code: exit, seconds, cpu, rssMb } = result;
    writer.write({ repo, exit, files: list.length, seconds, cpu, rssMb });
    let lines = 0;
    for (const document of jsonDocuments(result.stdout)) {
      const line = document as { path?: string };
      if (line.path === undefined) continue;
      lines++;
      writer.write({ ...line, path: `${nameOf(repo)}/${line.path.replace(/^\.\//, "")}` });
    }
    rows.push([repo, String(exit), list.length, lines, seconds, cpu, rssMb]);
  }
  writer.close();
  console.log(table(["Repository", "Exit", "Files", "Lines", "Wall (s)", "CPU (s)", "Max RSS (MB)"], rows));
}
