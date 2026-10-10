// The configuration files of ESLint 8 (`.eslintrc.*`, `package.json#eslintConfig`, `.eslintignore`) and its command line: one
// small project per row of eslintrc-cli-cases.mjs, linted by `bun lint`, compared with what ESLint 8.57.1 does with it: the exit
// code, which files are linted, every message (line, column, severity, rule, text), the files after `--fix`, what
// `--print-config` prints, and where ESLint stops with an error, the sentences of that error.
//
//   bun eslintrc-cli.mjs --scratch=<directory> --bin="<bun-lint> cli" [--only=substring] [--verbose] [--report=<file.md or .json>]
//   bun eslintrc-cli.mjs --scratch=<directory> --bin=.. --eslint=<eslint 8.57.1>/bin/eslint.js      ESLint runs too
//   bun eslintrc-cli.mjs --scratch=<directory> --eslint=.. --record                                 writes eslintrc-cli.expected.json
//   bun eslintrc-cli.mjs --scratch=<directory> --bin=.. --write-differences                         writes eslintrc-cli.differences.json
//
// `--bin` is the command that stands for `bun lint`. Nothing above `--scratch` may have a configuration file: ESLint 8 looks
// in all directories up to the root. What a row needs of npm it writes into its own node_modules.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cases, topics } from "./eslintrc-cli-cases.mjs";

const here = import.meta.dirname;
export const expectedPath = path.join(here, "eslintrc-cli.expected.json");
export const differencesPath = path.join(here, "eslintrc-cli.differences.json");

/** Writes the project of a row below `root`. `<dir>` in a text is `root`. Returns the directories that the run needs. */
export function write(root, row) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  root = fs.realpathSync(root);
  const slashes = root.replaceAll("\\", "/");
  for (const [name, text] of Object.entries(row.files)) {
    if (text === undefined) continue;
    const file = path.join(root, "project", name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (text === null) fs.mkdirSync(file);
    else if (typeof text === "object") fs.symlinkSync(text.link, file);
    else fs.writeFileSync(file, text.replaceAll("<dir>", `${slashes}/project`));
  }
  const home = row.home === undefined ? path.join(root, "home") : path.join(root, "project", row.home);
  const cwd = path.join(root, "project", row.cwd ?? ".");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  return { project: path.join(root, "project"), cwd, home };
}

export const argumentsOf = (row, project) =>
  (row.args?.includes("--print-config") ? row.args : ["-f", "json", ...(row.args ?? ["a.js"])]).map(it =>
    it.replaceAll("<dir>", project),
  );

export const environment = (row, home, base = process.env) => ({
  ...base,
  NO_COLOR: undefined,
  FORCE_COLOR: undefined,
  AGENT: "0",
  CLAUDECODE: undefined,
  GITHUB_ACTIONS: undefined,
  ESLINT_USE_FLAT_CONFIG: undefined,
  HOME: home,
  USERPROFILE: home,
  ...row.env,
});

// Advice, and what Node.js adds to an error.
const noise = [
  /^Oops! Something went wrong! :\($/,
  /^ESLint: \d+\.\d+\.\d+$/,
  /^at .*(\(.*\)|:\d+:\d+)$/,
  /^Require stack:$/,
  /^- .*\.c?js$/,
  /^If you (still|think|don't want|do want) /,
  /^It's likely that the plugin isn't installed correctly\./,
  /^npm (install|init) /,
  /^Please (check for typing mistakes|remove the "plugins" setting) /,
  /^\* /,
  /^See (also: )?https:/,
  /^\(node:\d+\) /,
  /^\(Use `node --trace-/,
];

const plain = (text, project) =>
  text
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replaceAll(project, "<dir>")
    .replaceAll(project.replaceAll("\\", "/"), "<dir>")
    .replaceAll(project.replaceAll("\\", "\\\\"), "<dir>")
    .replaceAll("\\", "/");

/** The sentences of an error of ESLint, one per line of its text. */
function sentences(text) {
  return text
    .split("\n")
    .map(it => it.trim().replace(/\s+/g, " "))
    .filter(it => it !== "" && !noise.some(pattern => pattern.test(it)))
    .map((it, index) => (index === 0 ? it.replace(/^\w*(Error|Exception)( \[\w+\])?: /, "") : it))
    .map(it => it.replace(/ To set up a configuration file for this project, please run:$/, ""));
}

function changed(project, row) {
  const written = {};
  for (const [name, text] of Object.entries(row.files)) {
    if (typeof text !== "string" || name.includes("node_modules/")) continue;
    let now;
    try {
      now = fs.readFileSync(path.join(project, name), "utf8");
    } catch {
      continue;
    }
    if (plain(now, project) !== text) written[name] = now;
  }
  return written;
}

const severities = { off: 0, warn: 1, error: 2 };

/** What `--print-config` prints, with the severities as numbers. */
function printed(config) {
  const rules = {};
  for (const [name, value] of Object.entries(config.rules ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [severity, ...options] = [value].flat();
    rules[name] = [severities[severity] ?? severity, ...options];
  }
  return { ...config, rules };
}

/** What a run did, in the shape of eslintrc-cli.expected.json. `raw` is all that was printed, for errors. */
export function outcome({ status, stdout, stderr }, { project, cwd }, row) {
  const result = { exit: status };
  let parsed;
  try {
    parsed = JSON.parse(stdout, (_, value) => (typeof value === "string" ? plain(value, project) : value));
  } catch {}
  if (Array.isArray(parsed)) {
    const base = plain(cwd, project);
    result.files = {};
    for (const file of parsed.sort((a, b) => (a.filePath < b.filePath ? -1 : 1))) {
      const name = file.filePath === "<text>" ? file.filePath : path.posix.relative(base, file.filePath);
      result.files[name] = file.messages.map(it => {
        const message = `${it.line ?? 0}:${it.column ?? 0} ${it.severity === 2 ? "error" : "warning"} ${it.ruleId ?? "-"} ${it.message}`;
        if (!row.detail) return message;
        const fix = it.fix ? ` [fix ${it.fix.range.join("-")} ${JSON.stringify(it.fix.text)}]` : "";
        return message + fix + (it.suggestions ?? []).map(it => ` [suggestion: ${it.desc}]`).join("");
      });
    }
    if (row.args?.includes("--fix")) result.written = changed(project, row);
  } else if (parsed && row.args?.includes("--print-config")) {
    result.config = printed(parsed);
  } else {
    result.error = sentences(plain(stderr + "\n" + stdout, project));
    if (row.lines !== undefined) result.error.length = Math.min(result.error.length, row.lines);
  }
  Object.defineProperty(result, "raw", { value: plain(stderr + "\n" + stdout, project).replace(/\s+/g, " ") });
  return result;
}

/**
 * `undefined` if `actual` is what `expected` is, else what differs: "exit", "messages" (also: one stops with an error and the
 * other does not), "written", "config", or "text": both stop with an error and the same exit code, and a sentence of ESLint's
 * is not in what was printed.
 */
export function difference(expected, actual) {
  if (expected.exit !== actual.exit) return "exit";
  if (expected.error) {
    if (!actual.error) return "messages";
    return expected.error.every(it => actual.raw.includes(it)) ? undefined : "text";
  }
  for (const [key, name] of [
    ["files", "messages"],
    ["written", "written"],
    ["config", "config"],
  ]) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) return name;
  }
}

export function run(command, root, row) {
  const directories = write(root, row);
  const result = spawnSync(command[0], [...command.slice(1), ...argumentsOf(row, directories.project)], {
    cwd: directories.cwd,
    input: row.stdin ?? "",
    env: environment(row, directories.home),
    encoding: "utf8",
    maxBuffer: 1 << 28,
    timeout: 120_000,
  });
  return outcome(result, directories, row);
}

const names = /^(\.eslintrc(\.(js|cjs|yaml|yml|json))?|eslint\.config\.[cm]?[jt]s|\.oxlintrc\.jsonc?)$/;

function configurationAbove(directory) {
  for (let it = directory; ; it = path.dirname(it)) {
    for (const name of fs.readdirSync(it)) {
      if (names.test(name)) return path.join(it, name);
      if (name === "package.json" && /"eslintConfig"/.test(fs.readFileSync(path.join(it, name), "utf8")))
        return path.join(it, name);
    }
    if (it === path.dirname(it)) return;
  }
}

const show = it => JSON.stringify(it, null, 1).replace(/\n */g, " ");

function report(rows) {
  const kinds = ["exit", "messages", "written", "config", "text"];
  const lines = [
    "| Topic | Rows | The same | Exit code | Messages | Files after --fix | --print-config | Only the text of the error |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const [topic, what] of Object.entries(topics)) {
    const mine = rows.filter(it => it.row.topic === topic);
    const count = kind => mine.filter(it => it.differs === kind).length;
    lines.push(`| ${topic}: ${what} | ${mine.length} | ${count(undefined)} | ${kinds.map(count).join(" | ")} |`);
  }
  const count = kind => rows.filter(it => it.differs === kind).length;
  lines.push(`| all | ${rows.length} | ${count(undefined)} | ${kinds.map(count).join(" | ")} |`, "");
  for (const [topic, what] of Object.entries(topics)) {
    const mine = rows.filter(it => it.row.topic === topic && it.differs);
    if (mine.length === 0) continue;
    lines.push(`## ${topic}: ${what}`, "");
    for (const { row, differs, expected, actual } of mine) {
      lines.push(`- **${row.name}** (${differs}): \`eslint ${(row.args ?? ["a.js"]).join(" ")}\``);
      lines.push(
        `  - ESLint 8: \`${show(expected).slice(0, 700)}\``,
        `  - here: \`${show(actual.error ? { exit: actual.exit, error: actual.error.slice(0, 6) } : actual).slice(0, 700)}\``,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const flag = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
  const has = name => process.argv.includes(`--${name}`);
  const scratch = path.resolve(flag("scratch"));
  const eslint = flag("eslint") && ["node", path.resolve(flag("eslint"))];
  const bin = flag("bin")?.split(" ");
  const only = flag("only");
  fs.mkdirSync(scratch, { recursive: true });
  const above = configurationAbove(scratch);
  if (above) {
    console.error(`${above} is above --scratch: ESLint 8 would read it`);
    process.exit(2);
  }
  const duplicate = cases.find((it, index) => cases.findIndex(other => other.name === it.name) !== index);
  if (duplicate) throw new Error(`two rows are called "${duplicate.name}"`);
  const unknown = cases.find(it => !(it.topic in topics));
  if (unknown) throw new Error(`"${unknown.name}" has the topic "${unknown.topic}"`);

  const root = path.join(scratch, "eslintrc");
  const some = cases.filter(it => (!only || it.name.includes(only)) && !(it.posix && process.platform === "win32"));
  const recorded = fs.existsSync(expectedPath) ? JSON.parse(fs.readFileSync(expectedPath, "utf8")) : {};

  if (has("record")) {
    for (const row of some) recorded[row.name] = run(eslint, root, row);
    const inOrder = Object.fromEntries(cases.filter(it => it.name in recorded).map(it => [it.name, recorded[it.name]]));
    fs.writeFileSync(
      expectedPath,
      "{\n" +
        Object.entries(inOrder)
          .map(([name, it]) => `  ${JSON.stringify(name)}: ${JSON.stringify(it)}`)
          .join(",\n") +
        "\n}\n",
    );
    console.log(`${some.length} rows recorded`);
  }

  const rows = [];
  let stale = 0;
  for (const row of bin ? some : []) {
    let expected = recorded[row.name];
    if (eslint && !has("record")) {
      const now = run(eslint, root, row);
      if (JSON.stringify(now) !== JSON.stringify(expected)) {
        stale++;
        console.log(`STALE ${row.name}\n  recorded ${show(expected)}\n  ESLint   ${show(now)}`);
      }
      expected = now;
    }
    if (!expected) throw new Error(`"${row.name}" is not recorded`);
    const actual = run(bin, root, row);
    const differs = difference(expected, actual);
    rows.push({ row, expected, actual, differs });
    if (!differs && has("verbose")) console.log(`ok   ${row.name}`);
    if (differs) {
      console.log(`FAIL ${row.name} (${row.topic}, ${differs}): eslint ${(row.args ?? ["a.js"]).join(" ")}`);
      console.log(`  ESLint 8 ${show(expected)}\n  here     ${show(actual)}`);
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
  if (bin) {
    if (flag("report")) {
      fs.writeFileSync(flag("report"), flag("report").endsWith(".json") ? JSON.stringify(rows, null, 1) : report(rows));
    }
    if (has("write-differences")) {
      const differences = rows
        .filter(it => it.differs)
        .map(it => `  ${JSON.stringify(it.row.name)}: ${JSON.stringify(it.differs)}`);
      fs.writeFileSync(differencesPath, `{\n${differences.join(",\n")}\n}\n`);
    }
    const failed = rows.filter(it => it.differs).length;
    console.log(`${rows.length - failed} passed, ${failed} failed${stale ? `, ${stale} recordings are stale` : ""}`);
    process.exit(failed || stale ? 1 : 0);
  }
}
