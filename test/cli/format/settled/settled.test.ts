import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, longLimit, spawn } from "../../children";
import { readBundle } from "../bundle.ts";
import { errors, expressionPlaces, expressions, layouts, typePlaces, types } from "./cases.ts";
import { mutate, random } from "./mutate.ts";
import { compare as compareWith, optionSets, type Result } from "./run.ts";

afterAll(endChildren);

// `src/format/js/settled` has the rules of the formatter a second time. See README.md.

const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");
const every = isDebug ? 100 : isASAN ? 20 : 1;

const compare = (files: Map<string, string>, options = {}) =>
  compareWith([bunExe()], files, {
    env: bunEnv,
    spawn: (it: any) => spawn({ ...it, timeout: longLimit }),
    ...options,
  });
const show = (results: Result[]) =>
  results
    .slice(0, Number(process.env.SHOW ?? 5))
    .map(it => `${it.verdict}, ${it.formatter}: ${it.path}\n${it.text.replace(/^(f\(\);?\n)+/gm, "$1")}`);

/** Among statements that all options leave alone, so that only a part of the file is formatted */
const among = (text: string, semi: unknown) => [lines(semi), text, lines(semi)].join("\n");
const [withSemicolons, without] = ["f();\n", "f()\n"].map(it => Buffer.alloc(40 * it.length, it).toString());
const lines = (semi: unknown) => (semi === false ? without : withSemicolons);

async function fmt(files: Record<string, string>, flags: string[]) {
  using dir = tempDir("format-settled", files);
  await using proc = spawn({
    cmd: [bunExe(), "fmt", ...flags],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const after = Object.keys(files).map(name => [name, readFileSync(join(String(dir), name), "utf8")]);
  return { stdout, stderr, exitCode, files: Object.fromEntries(after) };
}

describe.concurrent.each([
  ["prettier", ".prettierrc"],
  ["oxfmt", ".oxfmtrc.json"],
])("as %s", (flavor, configuration) => {
  const [configurations, good, bad, fixed, invalid] = [{}, {}, {}, {}, {}] as Record<string, string>[];
  layouts.forEach(([extension, formatted, others, options], i) => {
    configurations[`l${i}/${configuration}`] = JSON.stringify({ printWidth: 80, ...options });
    good[`l${i}/alone.${extension}`] = formatted;
    good[`l${i}/among.${extension}`] = among(formatted, options?.semi);
    others.forEach((other, j) => {
      bad[`l${i}/alone${j}.${extension}`] = other;
      fixed[`l${i}/alone${j}.${extension}`] = formatted;
      // Empty lines at the ends would be between statements.
      if (/^\n|\n\n$|[^\n]$/.test(other)) return;
      bad[`l${i}/among${j}.${extension}`] = among(other, options?.semi);
      fixed[`l${i}/among${j}.${extension}`] = among(formatted, options?.semi);
    });
  });
  errors.forEach(([extension, valid, wrong, onlyFor = flavor], i) => {
    good[`e${i}/alone.${extension}`] = valid;
    good[`e${i}/among.${extension}`] = among(valid, true);
    const list = onlyFor === flavor ? invalid : good;
    list[`e${i}/alone1.${extension}`] = wrong;
    list[`e${i}/among1.${extension}`] = among(wrong, true);
  });
  const missing = (names: Set<string>, files: Record<string, string>) =>
    Object.keys(files).flatMap(name => (names.has(name) ? [] : `${name}\n${files[name.replace("among", "alone")]}`));
  const around = { [configuration]: "{}", ".prettierignore": ".*rc\n.*rc.json\n", ...configurations };

  test("--check passes what is formatted", async () => {
    const [listed, checked] = await Promise.all(["-l", "--check"].map(it => fmt({ ...around, ...good }, [it])));
    expect([listed.stdout, listed.stderr.replace(/^(Checked|Finished).*\n/m, "")]).toEqual(["", ""]);
    expect([listed.exitCode, checked.exitCode]).toEqual([0, 0]);
  });

  test("--check fails what is not", async () => {
    const [listed, checked] = await Promise.all(["-l", "--check"].map(it => fmt({ ...around, ...bad }, [it])));
    const names = new Set(listed.stdout.replaceAll("\\", "/").split("\n"));
    expect(missing(names, bad)).toEqual([]);
    expect([listed.exitCode, checked.exitCode]).toEqual([1, 1]);
  });

  test("what is not formatted is written", async () => {
    const { files, exitCode } = await fmt({ ...around, ...bad }, []);
    expect(files).toEqual({ ...around, ...fixed });
    expect(exitCode).toBe(0);
  });

  test("what is not valid is an error", async () => {
    const { stderr, files, exitCode } = await fmt({ ...around, ...invalid }, []);
    const names = new Set(stderr.replaceAll("\\", "/").match(/\be\d+\/\w+\.\w+/g));
    expect(missing(names, invalid)).toEqual([]);
    expect(files).toEqual({ ...around, ...invalid });
    expect(exitCode).toBe(2);
  });
});

// Or else the tests above say nothing about it.
test.skipIf(!hasRunner)("the valid cases are recognized without the formatter", async () => {
  const texts = [...layouts.filter(it => !it[3]), ...errors].map(([extension, text], i) => [`${i}.${extension}`, text]);
  const files = ["prettier", "oxfmt"].flatMap(set => texts.map(([name, text]) => [`${set}/${name}`, text] as const));
  const results = await compare(new Map(files), { more: { printWidth: 80 } });
  expect(show(results.filter(it => it.verdict !== "Formatted"))).toEqual([]);
});

test.skipIf(!hasRunner).concurrent.each([
  ["prettier", "tsx"],
  ["prettier", "jsx"],
  ["oxfmt", "tsx"],
  ["oxfmt", "jsx"],
  ["standard", "tsx"],
  ["wide", "ts"],
])("everything in every place: %s, %s", async (set, extension) => {
  const inFunction = (place: string) => `async function* g() {\n  ${place}\n}\n`;
  const texts = [
    [expressions, expressionPlaces.map(inFunction).concat("export default $;\n", "export = $;\n", "@$\nclass X {}\n")],
    [types, typePlaces.map(place => `${place}\n`)],
  ].flatMap(([parts, places]) =>
    places.flatMap(place => parts.flatMap(it => [it, `(${it})`].map(part => place.replace(/\$(?!\{)/, () => part)))),
  );
  const files = new Map(texts.filter((_, i) => i % every === 0).map((text, i) => [`${set}/${i}.${extension}`, text]));
  const results = await compare(files, { wantsFormatted: true });
  expect(show(results.filter(it => !it.agrees))).toEqual([]);
  const again = await compare(new Map(results.filter(it => it.formatted).map(it => [it.path, it.formatted!])));
  expect(show(again.filter(it => !it.agrees))).toEqual([]);
  expect(again.filter(it => it.verdict === "Formatted").length).toBeGreaterThan(0.5 * again.length);
});

test.skipIf(!hasRunner).concurrent.each(["all", "none"])(
  "every comment around every argument: trailingComma %s",
  async trailingComma => {
    const [f, arrow, object] = ["function () {\n    a;\n  }", "() => {\n    a;\n  }", "{\n    a: 1,\n  }"];
    const lists = [[f, "b"], [arrow, "b"], [f, "{}"], [f, "[]"], ["b", f], ["b", object], ["b", "c", arrow], ["[]", arrow]]; // prettier-ignore
    const places = ["$ #,", "$, #", "#\n  $,", "$,\n  #", "# $,"];
    const texts = lists.flatMap(list =>
      ["/* c */", "// c", "/** c */", "/* a */ /* b */"].flatMap(comment =>
        places.flatMap(place =>
          list.flatMap((_, at) => {
            const line = (it: string, i: number) => {
              const written = (i === at ? place : "$,").replace("#", comment);
              const isBare = trailingComma === "none" && i === list.length - 1;
              return "  " + (isBare ? written.replace(",", "") : written).replace("$", () => it);
            };
            return ["h", "new H", "a.h"].map(callee => `${callee}(\n${list.map(line).join("\n")}\n);\n`);
          }),
        ),
      ),
    );
    const files = ["prettier", "oxfmt"].flatMap(set => texts.map((text, i) => [`${set}/${i}.js`, text] as const));
    const results = await compare(new Map(files.filter((_, i) => i % every === 0)), { more: { trailingComma } });
    expect(show(results.filter(it => !it.agrees))).toEqual([]);
    expect(results.filter(it => it.verdict === "Formatted").length).toBeGreaterThan(0.1 * results.length);
  },
);

const bundle = [...readBundle(join(import.meta.dir, "corpus.zst"))];
const givenUp = new Set(readFileSync(join(import.meta.dir, "given-up.txt"), "utf8").split(/\r?\n/));

describe.skipIf(!hasRunner).concurrent.each(Object.keys(optionSets))("corpus.zst, %s", set => {
  const all = bundle.filter(([path]) => path.startsWith(`${set}/`));
  const corpus = new Map(all.filter((_, i) => i % every === 0).map(([path, text]) => [path, text.toString()]));

  test("what the formatter has come to print otherwise is not taken for formatted", async () => {
    const results = await compare(corpus);
    expect(show(results.filter(it => !it.agrees))).toEqual([]);
    const lost = results.filter(it => it.formatter === "keeps" && it.verdict !== "Formatted");
    expect(show(lost.filter(it => !givenUp.has(it.path)))).toEqual([]);
    expect(results.filter(it => it.verdict === "Formatted").length).toBeGreaterThan(0.5 * corpus.size);
  });

  test("nor is what is formatted for other options", async () => {
    const width = Number(optionSets[set].printWidth ?? 80);
    const flavor = optionSets[set].flavor ? "prettier" : "oxfmt";
    const changes = [-1, 1, -9, 9].map(it => ({ printWidth: width + it }));
    for (const more of [...changes, { endOfLine: "crlf" }, ...(set === "trivago" ? [] : [{ flavor }])]) {
      expect([more, show((await compare(corpus, { more })).filter(it => !it.agrees))]).toEqual([more, []]);
    }
    const crlf = new Map([...corpus].map(([path, text]) => [path, text.replaceAll("\n", "\r\n")]));
    const results = await compare(crlf, { more: { endOfLine: "crlf" } });
    expect(show(results.filter(it => !it.agrees))).toEqual([]);
    expect(results.filter(it => it.verdict === "Formatted").length).toBeGreaterThan(0.5 * corpus.size);
  });

  test("nor is what is next to something that only the formatter knows", async () => {
    const end = optionSets[set].semi === false ? "\n" : ";\n";
    for (const other of ["a = /** @type {B} */ (c)", "a = [ b ]"]) {
      const files = new Map([...corpus].map(([path, text]) => [path, among(text, optionSets[set].semi) + other + end]));
      const results = await compare(files);
      expect(show(results.filter(it => !it.agrees))).toEqual([]);
      expect(results.filter(it => it.verdict === "Reduced").length).toBeGreaterThan(0.5 * corpus.size);
    }
  });

  test("nor is what has been changed a little", async () => {
    const next = random(Number(process.env.SEED ?? 1));
    const mutants = new Map<string, string>();
    for (const [path, text] of corpus) {
      for (let i = 0; i < 3; i++) {
        const mutant = mutate(i === 2 ? mutate(text, next) : text, next);
        mutants.set(path.replace("/", `/${i}-`), i % 2 ? among(mutant, optionSets[set].semi) : mutant);
      }
    }
    const results = await compare(mutants, { wantsFormatted: true });
    expect(show(results.filter(it => !it.agrees))).toEqual([]);
    // All kinds are there.
    const share = (is: (it: Result) => boolean) => results.filter(is).length / results.length;
    expect({
      changed: share(it => it.formatter === "changes") > 0.2,
      rejected: share(it => it.formatter === "rejects") > 0.2,
      recognized: share(it => it.verdict === "Formatted") > 0.05,
      inPart: share(it => it.verdict === "Reduced") > 0.03,
    }).toEqual({ changed: true, rejected: true, recognized: true, inPart: true });

    const changed = results.filter(it => it.formatter === "changes");
    const again = await compare(new Map(changed.map(it => [it.path, it.formatted!])));
    expect(show(again.filter(it => !it.agrees))).toEqual([]);
  });
});
