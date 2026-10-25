// Every case of draft 2020-12 and draft-07 of the official JSON Schema Test Suite (test/js/bun/validator/JSON-Schema-Test-Suite), compiled:
// each group becomes `validate<Schema.FromJSONSchema<typeof schema>>(value)` and `JSON.parse<Schema.FromJSONSchema<typeof schema>>(text)`.
// A group is either compiled and answers as the suite says, or the build refuses it and names the keyword.
import { describe, expect } from "bun:test";
import { isASAN, isDebug } from "harness";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "../supported";
import { type Group, type Outcome, compileAndRun, judge, refusalsOf, summaryOf } from "./compiled-groups";
import { type Draft, checkedFormats } from "./what-the-build-refuses";

const suite = join(import.meta.dir, "..", "..", "js", "bun", "validator", "JSON-Schema-Test-Suite");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

function* jsonFiles(folder: string): Generator<string> {
  for (const name of readdirSync(folder).sort()) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) yield* jsonFiles(path);
    else if (name.endsWith(".json")) yield path;
  }
}

const remotes: Record<string, unknown> = {};
for (const path of jsonFiles(join(suite, "remotes"))) {
  remotes["http://localhost:1234/" + relative(join(suite, "remotes"), path).replaceAll("\\", "/")] = read(path);
}

function* references(schema: unknown): Generator<string> {
  if (typeof schema !== "object" || schema === null) return;
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$ref" && typeof value === "string") yield value;
    else yield* references(value);
  }
}

/** The files of `remotes` that the schema names, and those that they name. */
function documentsOf(schema: unknown): Record<string, unknown> | undefined {
  const found: Record<string, unknown> = {};
  const visit = (from: unknown, base: string | undefined) => {
    for (const reference of references(from)) {
      if (!URL.canParse(reference, base)) continue;
      const uri = new URL(reference, base);
      uri.hash = "";
      if (!Object.hasOwn(remotes, uri.href) || Object.hasOwn(found, uri.href)) continue;
      found[uri.href] = remotes[uri.href];
      visit(remotes[uri.href], uri.href);
    }
  };
  const id = typeof schema === "object" && schema !== null && "$id" in schema ? schema.$id : undefined;
  visit(schema, typeof id === "string" ? id : undefined);
  return Object.keys(found).length > 0 ? found : undefined;
}

// Optional files about what Bun gives no meaning to, and why.
const optionalFilesLeftOut: Record<string, string> = {
  "optional/content": "contentEncoding, contentMediaType and contentSchema are annotations",
  "optional/cross-draft": "draft 2019-09 is refused",
};

// A label that begins with "xn--" spells other characters, and which of those a host name may hold is a table of its own.
// A host name that the suite calls invalid is refused. One that it calls valid may be refused too, so those cases have no verdict here. They are counted.
const validHostNamesWithoutVerdict = 15;
function hasNoVerdict(file: string, data: unknown, valid: boolean): boolean {
  return file === "optional/format/hostname" && valid && typeof data === "string" && /(?:^|\.)xn--/i.test(data);
}

// Groups that have a translation and that the build does not take yet: "<folder>/<file>: <group>" and why. It excuses a build error alone.
const notYet: Record<string, string> = {};

/** Bun checks `format`. The suite's required files say that a validator does not, unless it is asked to. */
function expectedOf(file: string, schema: unknown, description: string, valid: boolean): boolean {
  if (file !== "format" || !valid || !/only an annotation by default$/.test(description)) return valid;
  const format = typeof schema === "object" && schema !== null && "format" in schema ? schema.format : undefined;
  return !(typeof format === "string" && checkedFormats.has(format));
}

function groupsOf(folder: string, draft: Draft, file: string): Group[] {
  return read(join(suite, "tests", folder, file + ".json")).map(
    (group: {
      description: string;
      schema: unknown;
      tests: { description: string; data: unknown; valid: boolean }[];
    }): Group => ({
      name: `${folder}/${file}: ${group.description}`,
      schema: group.schema,
      draft,
      documents: documentsOf(group.schema),
      cases: group.tests
        .filter(({ data, valid }) => !hasNoVerdict(file, data, valid))
        .map(({ description, data, valid }) => ({
          description,
          text: JSON.stringify(data),
          expected: expectedOf(file, group.schema, description, valid),
        })),
    }),
  );
}

function countWithoutVerdict(folder: string, file: string): number {
  const groups: { tests: { data: unknown; valid: boolean }[] }[] = read(join(suite, "tests", folder, file + ".json"));
  return groups.flatMap(group => group.tests).filter(({ data, valid }) => hasNoVerdict(file, data, valid)).length;
}

const timeout = isASAN || isDebug ? 1_800_000 : 600_000;

for (const [folder, draft] of [
  ["draft2020-12", "2020-12"],
  ["draft7", "draft-07"],
] as const) {
  describe(folder, () => {
    const root = join(suite, "tests", folder);
    const files = [...jsonFiles(root)].map(path =>
      relative(root, path)
        .replaceAll("\\", "/")
        .replace(/\.json$/, ""),
    );
    const taken = files.filter(file => !Object.hasOwn(optionalFilesLeftOut, file));

    // The groups that must be refused share one program: one build says all of its errors.
    let started: { refused: Promise<Outcome[]>; byFile: Map<string, Promise<Outcome[]>> } | undefined;
    function start() {
      if (started) return started;
      const mustBeRefused: Group[] = [];
      const byFile = new Map<string, Promise<Outcome[]>>();
      const rest = new Map<string, Group[]>();
      for (const file of taken) {
        const groups = groupsOf(folder, draft, file);
        mustBeRefused.push(...groups.filter(group => refusalsOf(group).must.size > 0));
        rest.set(
          file,
          groups.filter(group => refusalsOf(group).must.size === 0),
        );
      }
      const refused = compileAndRun(folder + "-refused", mustBeRefused);
      refused.catch(() => {});
      for (const [file, groups] of rest) {
        const outcomes = compileAndRun(folder + "-" + file, groups);
        outcomes.catch(() => {});
        byFile.set(file, outcomes);
      }
      return (started = { refused, byFile });
    }

    for (const file of files) {
      if (Object.hasOwn(optionalFilesLeftOut, file))
        console.error(`SKIPPED: ${folder}/${file}: ${optionalFilesLeftOut[file]}`);
    }

    test("how many cases have no verdict", () => {
      const count = taken.reduce((sum, file) => sum + countWithoutVerdict(folder, file), 0);
      if (count > 0)
        console.error(`SKIPPED: ${folder}: ${count} valid host names with a label that begins with "xn--"`);
      expect(count).toBe(validHostNamesWithoutVerdict);
    });

    for (const file of taken) {
      test(
        file,
        async () => {
          const { refused, byFile } = start();
          const prefix = `${folder}/${file}: `;
          const outcomes = [
            ...(await byFile.get(file)!),
            ...(await refused).filter(({ group }) => group.name.startsWith(prefix)),
          ];
          expect(judge(outcomes, notYet)).toEqual([]);
        },
        timeout,
      );
    }

    test(
      "how much is compiled",
      async () => {
        const { refused, byFile } = start();
        const outcomes = [...(await refused), ...(await Promise.all(byFile.values())).flat()];
        console.log(summaryOf(folder, outcomes));
        expect(
          outcomes.filter(({ group, refusedWith }) => refusedWith === undefined && group.cases.length > 0).length,
        ).toBeGreaterThan(0);
      },
      timeout,
    );
  });
}
