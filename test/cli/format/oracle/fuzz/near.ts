// Texts that are nearly normal: Prettier's fixtures, or real files, each a little changed: a token deleted, two neighbours deleted, a token
// doubled, swapped with the next, or the text cut off after it. That is what a file looks like while it is typed. `bun format --write` runs on
// them, with the checks that it makes before it writes, and the npm package of Prettier, or oxfmt, is asked about each.
//
//   bun near.ts --command="bun format" --prettier=<directory with node_modules/prettier> --language=css
//     [--oxfmt=<directory with node_modules/oxfmt>]  the flavor of oxfmt, against oxfmt
//     [--options]            each text with one of SETS in the place of the defaults
//     [--files=<directory>]  real files in the place of the fixtures, one change each. More than once: more directories
//     [--most=50000]         at most so many texts
//     [--per-file=40]        about twice so many texts from a fixture
//     [--seed=1] [--jobs=4] [--out=<file>]  what differs, one JSON object on a line, the shortest text of each kind first
//     [--texts=<directory>]  the texts that both accept are kept there, for who wants to try a check on them
//
// Languages: js (with jsx, ts, tsx), css (with less, scss), yaml, graphql, json, handlebars, markdown (with mdx), html (with vue, angular, mjml).
// Nothing is stored: what is expected is asked when it is run. The same seed makes the same texts.
//
// It prints two tables. The second is about refusals: `bun format` leaves a file alone if what it has printed does not say what the file says.
// Where the other tool prints something, that is a true alarm if the other tool has lost or added a letter or a digit (in HTML and Handlebars also
// a `<` or a `{`), and a false one if not.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBundle } from "../../bundle.ts";

async function load(directory: string, specifier: string) {
  const module = await import(pathToFileURL(createRequire(resolve(directory, "index.js")).resolve(specifier)).href);
  return module.format ? module : module.default;
}

// The other tool runs in processes of its own: it can hang, and oxfmt, which is native code, can end the process.
if (process.argv[2] == "--child") {
  let tool: any;
  process.on("message", async ({ directory, isOxfmt, name, text, options }: any) => {
    tool ??= await load(directory, isOxfmt ? "oxfmt" : "prettier");
    try {
      if (isOxfmt) {
        const result = await tool.format(name, text, options);
        process.send!(
          result.errors.length ? { error: String(result.errors[0].message).split("\n")[0] } : { expected: result.code },
        );
      } else process.send!({ expected: await tool.format(text, { ...options, filepath: name }) });
    } catch (error) {
      process.send!({ error: String((error as Error).message ?? error).split("\n")[0] });
    }
  });
} else {
  const flags = new Map<string, string[]>();
  for (const argument of process.argv.slice(2)) {
    const [, name, value = "true"] = /^--([\w-]+)(?:=(.*))?$/s.exec(argument) ?? [];
    if (!name) throw new Error(`what is ${argument}?`);
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  const flag = (name: string, otherwise = "") => flags.get(name)?.[0] ?? otherwise;
  const isOxfmt = flags.has("oxfmt");
  const language = flag("language");

  /** The endings of the names of each language. The longest that fits counts. */
  const ENDINGS: Record<string, string[]> = {
    js: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"],
    css: [".css", ".less", ".scss"],
    yaml: [".yaml", ".yml"],
    graphql: [".graphql", ".gql"],
    json: [".json", ".jsonc", ".json5"],
    handlebars: [".hbs", ".handlebars"],
    markdown: [".md", ".mdx"],
    html: [".component.html", ".html", ".vue", ".mjml"],
  };
  /** The directories of Prettier's tests/format. */
  const FIXTURES: Record<string, string[]> = {
    js: ["js", "jsx", "typescript"],
    css: ["css", "less", "scss"],
    yaml: ["yaml"],
    graphql: ["graphql"],
    json: ["json"],
    handlebars: ["handlebars"],
    markdown: ["markdown", "mdx"],
    html: ["html", "vue", "angular", "mjml"],
  };
  const endings = ENDINGS[language];
  if (!endings || !flags.has("command") || !(flags.has("prettier") || isOxfmt)) {
    throw new Error(
      `usage: bun near.ts --command="bun format" --prettier=<directory> --language=<${Object.keys(ENDINGS).join("|")}> ..`,
    );
  }

  /** With `--options`. Both tools have all of these. */
  const SETS: Record<string, unknown>[] = [
    { semi: false, singleQuote: true },
    { useTabs: true, printWidth: 120 },
    { printWidth: 40, tabWidth: 4 },
    { trailingComma: "none", arrowParens: "avoid", bracketSpacing: false },
    { trailingComma: "es5", quoteProps: "consistent", jsxSingleQuote: true },
    { bracketSameLine: true, singleAttributePerLine: true, objectWrap: "collapse" },
    { endOfLine: "crlf" },
    { proseWrap: "always", printWidth: 60 },
    { proseWrap: "never" },
    { embeddedLanguageFormatting: "off", quoteProps: "consistent" },
    { printWidth: 120, useTabs: true, htmlWhitespaceSensitivity: "ignore", vueIndentScriptAndStyle: true },
    { printWidth: 40, htmlWhitespaceSensitivity: "strict", singleQuote: true, semi: false },
  ];
  /** Only Prettier has these. */
  const SETS_OF_PRETTIER: Record<string, unknown>[] = [
    { experimentalTernaries: true, tabWidth: 4 },
    { experimentalOperatorPosition: "start" },
  ];
  const sets = !flags.has("options") ? [{}] : isOxfmt ? SETS : [...SETS, ...SETS_OF_PRETTIER];

  let state = Number(flag("seed", "1")) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** `count` of the numbers below `below`, each once. */
  function some(below: number, count: number) {
    const all = Array.from({ length: below }, (_, index) => index);
    for (let i = 0; i < Math.min(count, below); i++) {
      const j = i + Math.floor(random() * (below - i));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, Math.min(count, below));
  }

  // In JavaScript a string, a template and a comment are one token each.
  const TOKEN =
    language == "js"
      ? /\s+|\/\/[^\n]*|\/\*[^]*?\*\/|[A-Za-z_$][\w$]*|\d[\w.]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[^])*`|=>|\.\.\.|\?\.|[-+*/%&|^<>=!?]+|[^]/gu
      : /\n|[ \t]+|[A-Za-z_$][\w$-]*|\d[\w.]*|[^]/gu;
  function changed(text: string, perFile: number) {
    const tokens = text.match(TOKEN) ?? [];
    // White space means nothing in JavaScript.
    const places = tokens.flatMap((token, index) => (language == "js" && /^(\s|\/\/|\/\*)/.test(token) ? [] : [index]));
    const texts = new Set<string>();
    const without = (...dropped: number[]) => tokens.filter((_, index) => !dropped.includes(index)).join("");
    const pick = (count: number) => some(places.length, count).map(index => places[index]);
    for (const at of pick(perFile)) texts.add(without(at));
    for (const index of some(places.length - 1, perFile >> 2)) texts.add(without(places[index], places[index + 1]));
    for (const at of pick(perFile >> 2)) texts.add([...tokens.slice(0, at + 1), ...tokens.slice(at)].join(""));
    for (const index of some(places.length - 1, perFile >> 2)) {
      const [a, b] = [places[index], places[index + 1]];
      texts.add(tokens.map((token, at) => (at == a ? tokens[b] : at == b ? tokens[a] : token)).join(""));
    }
    for (const at of pick(perFile >> 2)) texts.add(tokens.slice(0, at + 1).join("") + "\n");
    return [...texts];
  }

  const endingOf = (name: string) => endings.find(ending => name.endsWith(ending));
  const most = Number(flag("most", "50000"));
  type Text = { name: string; text: string; set: number };
  const texts: Text[] = [];
  const add = (ending: string, text: string) =>
    texts.push({ name: `${texts.length}${ending}`, text, set: Math.floor(random() * sets.length) });
  if (flags.has("files")) {
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (entry.name == "node_modules" || entry.name.startsWith(".")) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (endingOf(entry.name) && statSync(path).size < 200_000) files.push(path);
      }
    };
    flags.get("files")!.forEach(walk);
    for (const index of some(files.length, most)) {
      const text = readFileSync(files[index], "utf8");
      if (text.includes("\ufffd") || text.includes("\r")) continue;
      const all = changed(text, 4);
      add(endingOf(files[index])!, all[Math.floor(random() * all.length)] ?? text);
    }
  } else {
    for (const [name, bytes] of readBundle(join(import.meta.dir, "../../prettier/bundle.zst"))) {
      const [top] = name.replace(/^\/?(tests\/format\/)?/, "").split("/");
      let ending = endingOf(name);
      if (
        !ending ||
        !FIXTURES[language].includes(top) ||
        name.includes("__snapshots__") ||
        basename(name) == "format.test.js"
      )
        continue;
      if (top == "angular" && ending == ".html") ending = ".component.html";
      const text = bytes.toString("utf8");
      if (text.length > 900 || text.length < 4 || text.includes("\r") || text.includes("\ufffd")) continue;
      add(ending, text);
      for (const it of changed(text, Number(flag("per-file", "40")))) add(ending, it);
    }
    if (texts.length > most) texts.splice(0, texts.length, ...some(texts.length, most).map(index => texts[index]));
  }

  // Ours: all of them at once, each set of options in a directory of its own.
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "near-"));
  sets.forEach((set, index) => {
    mkdirSync(join(root, String(index)));
    // oxfmt's own width is 100.
    const config = isOxfmt ? { printWidth: 80, ...set } : set;
    writeFileSync(join(root, String(index), isOxfmt ? ".oxfmtrc.json" : ".prettierrc.json"), JSON.stringify(config));
  });
  for (const it of texts) writeFileSync(join(root, String(it.set), it.name), it.text);
  const ran = spawnSync("/bin/sh", ["-c", `ulimit -c 0; exec ${flag("command")} --write --log-level=error .`], {
    cwd: root,
    maxBuffer: 1 << 30,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (ran.signal || (ran.status ?? 3) > 2) console.log(`THE COMMAND ENDED WITH ${ran.signal ?? ran.status}`);
  const refusals = new Map<string, string>();
  for (const line of ran.stderr.toString().split("\n")) {
    const [, path, message] = /^\[error\] (\d+\/\d+\.[\w.]+): (.*)$/.exec(line) ?? [];
    if (path && !refusals.has(path)) refusals.set(path, message);
  }

  // Theirs.
  const directory = isOxfmt ? flag("oxfmt") : flag("prettier");
  type Answer = { expected?: string; error?: string; hangs?: boolean; dies?: boolean };
  let next = 0;
  const answers: Answer[] = [];
  await Promise.all(
    Array.from({ length: Number(flag("jobs", "4")) }, async () => {
      let child: ReturnType<typeof Bun.spawn> | undefined;
      let done: (answer: Answer) => void = () => {};
      while (next < texts.length) {
        const index = next++;
        const { name, text, set } = texts[index];
        child ??= Bun.spawn([process.execPath, import.meta.path, "--child"], {
          stdio: ["ignore", "ignore", "ignore"],
          ipc: message => done(message),
          onExit: () => done({ dies: true }),
        });
        answers[index] = await new Promise<Answer>(resolve => {
          const timer = setTimeout(() => done({ hangs: true }), 8000);
          done = answer => (clearTimeout(timer), resolve(answer));
          child!.send({
            directory,
            isOxfmt,
            name,
            text,
            options: isOxfmt ? { printWidth: 80, ...sets[set] } : sets[set],
          });
        });
        done = () => {};
        if (answers[index].hangs || answers[index].dies) {
          child.kill();
          child = undefined;
        }
      }
      child?.kill();
    }),
  );

  // A formatter adds and drops brackets, commas, semicolons and quotes. Not where a tag or a mustache starts.
  const COUNTED = language == "handlebars" || language == "html" ? /[a-z0-9<{]/g : /[a-z0-9]/g;
  const lettersOf = (text: string) => (text.toLowerCase().match(COUNTED) ?? []).sort().join("");
  const shape = (line = "") =>
    line
      .replace(/[\w$\u0080-\uffff]+/g, "a")
      .replace(/\s+/g, " ")
      .slice(0, 40);
  const kindOfMessage = (message: string) =>
    message
      .replace(/\(\d+:\d+\)/, "")
      .replace(/\d+/g, "N")
      .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "'..'")
      .slice(0, 70)
      .trim();
  const counts = new Map<string, Record<string, number>>();
  const alarms = new Map<string, { texts: number; isTrue: number }>();
  type Row = {
    verdict: string;
    kind: string;
    count: number;
    name: string;
    options: unknown;
    text: string;
    ours: string;
    theirs: string;
  };
  const kinds = new Map<string, Row>();
  if (flags.has("texts")) mkdirSync(flag("texts"), { recursive: true });
  texts.forEach(({ name, text, set }, index) => {
    const ending = endingOf(name)!;
    const refusal = refusals.get(`${set}/${name}`);
    const { expected, error, hangs, dies } = answers[index];
    const ours = refusal === undefined ? readFileSync(join(root, String(set), name), "utf8") : undefined;
    const isSyntax = refusal !== undefined && /^(SyntaxError|RangeError)/.test(refusal);
    const verdict = hangs
      ? "the other hangs"
      : dies
        ? "the other dies"
        : ours === undefined
          ? error !== undefined
            ? "both refuse"
            : isSyntax
              ? "only we refuse: syntax"
              : "only we refuse: a check"
          : error !== undefined
            ? "only the other refuses"
            : ours == expected
              ? "same"
              : "different";
    const row = counts.get(ending) ?? {};
    counts.set(ending, row);
    row.texts = (row.texts ?? 0) + 1;
    row[verdict] = (row[verdict] ?? 0) + 1;
    if (flags.has("texts") && ours !== undefined && expected !== undefined)
      writeFileSync(join(flag("texts"), name), text);
    if (verdict == "only we refuse: a check") {
      const key = `${ending} | ${refusal!.replace(/\. It is left as it is.*$/, "")}`;
      const alarm = alarms.get(key) ?? { texts: 0, isTrue: 0 };
      alarms.set(key, alarm);
      alarm.texts++;
      if (lettersOf(text) != lettersOf(expected!)) alarm.isTrue++;
    }
    if (verdict == "same" || verdict == "both refuse") return;
    let kind = verdict;
    if (verdict == "different") {
      const [a, b] = [ours!.split("\n"), expected!.split("\n")];
      const at = a.findIndex((line, index) => line !== b[index]);
      kind = `${shape(a[at])} ~ ${shape(b[at < 0 ? a.length : at])}`;
    } else if (verdict == "only the other refuses") kind = kindOfMessage(error!);
    else if (refusal !== undefined)
      kind = `${kindOfMessage(refusal)}${isSyntax || lettersOf(text) != lettersOf(expected ?? "") ? "" : " (false alarm)"}`;
    const found = kinds.get(`${ending} ${kind}`);
    const it = {
      verdict,
      kind,
      name,
      options: sets[set],
      text,
      ours: ours ?? refusal!,
      theirs: expected ?? `throws: ${error}`,
    };
    if (!found) kinds.set(`${ending} ${kind}`, { ...it, count: 1 });
    else Object.assign(found, text.length < found.text.length ? it : {}, { count: found.count + 1 });
  });
  rmSync(root, { recursive: true, force: true });

  const columns = [
    "texts",
    "both refuse",
    "same",
    "different",
    "only we refuse: syntax",
    "only we refuse: a check",
    "only the other refuses",
    "the other hangs",
    "the other dies",
  ];
  console.log(`| ending | ${columns.join(" | ")} |\n| --- | ${columns.map(() => "---:").join(" | ")} |`);
  for (const [ending, row] of counts)
    console.log(`| ${ending} | ${columns.map(column => row[column] ?? 0).join(" | ")} |`);
  console.log(
    `\n| ending | the check that fired | texts | true alarm: the other tool changes letters or digits | false alarm |\n| --- | --- | ---: | ---: | ---: |`,
  );
  for (const [key, { texts, isTrue }] of alarms) console.log(`| ${key} | ${texts} | ${isTrue} | ${texts - isTrue} |`);
  const all = [...kinds.values()].sort((a, b) => b.count - a.count);
  console.log(`\n${all.reduce((sum, it) => sum + it.count, 0)} texts in ${all.length} kinds`);
  if (flags.has("out")) writeFileSync(flag("out"), all.map(it => JSON.stringify(it) + "\n").join(""));
}
