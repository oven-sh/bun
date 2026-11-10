import { createHash } from "node:crypto";
import ts from "typescript";

/** A ```ts, ```typescript or ```tsx code block of a docs page. */
export interface Sample {
  /** From the repository root, with forward slashes. */
  page: string;
  /** The line of the page that opens the code block, from 1. */
  line: number;
  /** `.d.ts` or `.tsx` if the code block is titled with such a file name, `.tsx` for a tsx block, otherwise `.ts`. */
  extension: string;
  /** The lines of the code block, without the indentation of its fence. */
  code: string;
  /** The width of that indentation. */
  indentation: number;
  /** `{/* fragment *\/}` is above the block: it is not meant to parse alone. */
  fragment: boolean;
  /** `{/* type-error TS2322 *\/}` is above the block: the page shows these errors on purpose. */
  typeErrors?: number[];
}

export interface SampleError {
  code: number;
  message: string;
  /** Where it is in the page, and the text of that line of the sample. */
  line: number;
  column: number;
  text: string;
  /** The parser reports it. What tsc says about the rest of such a sample is about what the parser guessed. */
  syntax: boolean;
}

/** Per page, the samples that fail with no marker: `keyOf(sample)` to `entryOf(errors)`. */
export type Inventory = Record<string, Record<string, string>>;

/** The samples of a page, and the markers that are not directly above one. */
export function samplesOf(page: string, text: string): { samples: Sample[]; problems: string[] } {
  const [samples, problems]: [Sample[], string[]] = [[], []];
  const lines = text.split(/\r?\n/);
  let marker: { line: number; typeErrors?: number[] } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const comment = /^[ \t]*\{\/\*\s*(fragment|type-error|prettier-ignore)\b\s*(.*?)\s*\*\/\}[ \t]*$/.exec(lines[i]);
    if (comment?.[1] === "prettier-ignore") continue;
    if (comment) {
      const codes = comment[2].split(/[\s,]+/).filter(Boolean);
      const valid =
        comment[1] === "fragment" ? codes.length === 0 : codes.length > 0 && codes.every(code => /^TS\d+$/.test(code));
      if (marker) problems.push(`${page}:${i + 1}: two markers for one code block`);
      if (!valid) problems.push(`${page}:${i + 1}: expected {/* fragment */} or {/* type-error TS2322 */}`);
      marker = {
        line: i + 1,
        typeErrors: comment[1] === "fragment" ? undefined : codes.map(code => Number(code.slice(2))),
      };
      continue;
    }
    // The language ends at `#` too: `ts#index.ts` titles a code block in some Markdown.
    const open = /^([ \t]*)(`{3,})[ \t]*([^`\s#]*)([^`]*)$/.exec(lines[i]);
    if (!open) {
      if (marker && lines[i].trim()) problems.push(`${page}:${marker.line}: the marker is not above a code block`);
      if (lines[i].trim()) marker = undefined;
      continue;
    }
    const [, indentation, fence, language, title] = open;
    // A code block that shows Markdown with a code block in it has a longer fence.
    const close = new RegExp(`^[ \\t]*\`{${fence.length},}[ \\t]*$`);
    const line = i + 1;
    const body: string[] = [];
    while (++i < lines.length && !close.test(lines[i])) {
      body.push(lines[i].startsWith(indentation) ? lines[i].slice(indentation.length) : lines[i].trimStart());
    }
    if (["ts", "typescript", "tsx"].includes(language)) {
      samples.push({
        page,
        line,
        extension: /\.d\.ts\b|\.tsx\b/.exec(title)?.[0] ?? (language === "tsx" ? ".tsx" : ".ts"),
        code: body.join("\n") + "\n",
        indentation: indentation.length,
        fragment: !!marker && !marker.typeErrors,
        typeErrors: marker?.typeErrors,
      });
    } else if (marker) {
      problems.push(`${page}:${marker.line}: the marker is above a code block that is not TypeScript`);
    }
    marker = undefined;
  }
  if (marker) problems.push(`${page}:${marker.line}: the marker is not above a code block`);
  return { samples, problems };
}

// The file or the package that a sample imports or references is not on the page. What an import gives the sample is
// `any`.
const MODULE_NOT_ON_THE_PAGE = new Set([2307, 2688, 2732, 2792, 2875, 2882, 6053, 7016, 7026]);
// The types declare every module of Bun and of Node.js, and bun-types has the files that a page tells its reader to
// reference. One that tsc cannot find is a mistake in the sample. A reference directive is reported from inside its
// quotes.
const MODULE_OF_THE_RUNTIME = /^["']?(?:bun|bun-types|node)["':/]/;

// tsc suggests a name for the first ten names of a program that it cannot find, under a code of its own. Which
// samples get one depends on the samples before them, so both codes count as the one without a suggestion.
const WITHOUT_SUGGESTION = new Map([
  [2552, 2304],
  [2833, 2503],
]);

/** The key of a sample in the inventory. An edit of the sample changes it. */
export function keyOf(sample: Sample) {
  return createHash("sha256").update(sample.code).digest("hex").slice(0, 12);
}

/** True if the syntax of a sample declares something that the other files of its program see. */
function declaresGlobals(sample: Sample) {
  if (sample.extension === ".d.ts") return true;
  const file = ts.createSourceFile(`sample${sample.extension}`, sample.code, ts.ScriptTarget.ESNext, true);
  if (file.referencedFiles.length + file.typeReferenceDirectives.length + file.libReferenceDirectives.length > 0)
    return true;
  const isAmbient = (node: ts.Node): boolean =>
    (ts.isModuleDeclaration(node) &&
      (ts.isStringLiteral(node.name) || (node.flags & ts.NodeFlags.GlobalAugmentation) !== 0)) ||
    !!ts.forEachChild(node, isAmbient);
  return isAmbient(file);
}

/**
 * Type checks the samples in a project that has `@types/bun` in `projectDir`/node_modules and no other file. Returns
 * what tsc reports for each, apart from modules that are not on the page.
 *
 * Every sample is a module, and the samples share one program. The exceptions get a program each, because they change
 * what every other file of their program type checks against: a sample that declares globals
 * (`/// <reference lib="dom" />`, `declare global`, `declare module`, a `.d.ts` file), and a sample that imports a
 * file that exists (`import "bun-types/test-globals"`).
 */
export function checkSamples(
  samples: Sample[],
  projectDir: string,
  compilerOptions: ts.CompilerOptions,
): Map<Sample, SampleError[]> {
  // `skipLibCheck` of a project would leave a sample that is a `.d.ts` file unchecked.
  const options = { ...compilerOptions, skipLibCheck: false };
  const root = projectDir.replaceAll("\\", "/");
  // A folder for each sample, so that no relative import of one sample resolves to another.
  const fileOf = (sample: Sample) =>
    `${root}/docs-samples/${sample.page}/line-${sample.line}/sample${sample.extension}`;
  const inProgram = new Map<string, Sample>();
  const parsed = new Map<string, ts.SourceFile | undefined>();
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.getCurrentDirectory = () => root;
  host.fileExists = fileName => inProgram.has(fileName) || fileExists(fileName);
  host.readFile = fileName => inProgram.get(fileName)?.code ?? readFile(fileName);
  host.getSourceFile = (fileName, languageVersionOrOptions, ...rest) => {
    const sample = inProgram.get(fileName);
    // The options carry `moduleDetection: "force"`, which makes a sample without imports a module.
    if (sample) return ts.createSourceFile(fileName, sample.code, languageVersionOrOptions, true);
    if (!parsed.has(fileName)) parsed.set(fileName, getSourceFile(fileName, languageVersionOrOptions, ...rest));
    return parsed.get(fileName);
  };

  const errors = new Map<Sample, SampleError[]>();
  let program: ts.Program | undefined;
  function check(together: Sample[]) {
    inProgram.clear();
    for (const sample of together) inProgram.set(fileOf(sample), sample);
    program = ts.createProgram({ rootNames: [...inProgram.keys()], options, host, oldProgram: program });
    for (const sample of together) {
      const file = program.getSourceFile(fileOf(sample))!;
      const lines = sample.code.split("\n");
      const toErrors = (diagnostics: readonly ts.Diagnostic[], syntax: boolean) =>
        diagnostics
          .filter(
            ({ code, start = 0 }) =>
              !MODULE_NOT_ON_THE_PAGE.has(code) || MODULE_OF_THE_RUNTIME.test(sample.code.slice(start)),
          )
          .map(diagnostic => {
            const { line, character } = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
            return {
              code: WITHOUT_SUGGESTION.get(diagnostic.code) ?? diagnostic.code,
              message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
              line: sample.line + 1 + line,
              column: sample.indentation + character + 1,
              text: lines[line].trim(),
              syntax,
            };
          });
      errors.set(sample, [
        ...toErrors(program.getSyntacticDiagnostics(file), true),
        ...toErrors(program.getSemanticDiagnostics(file), false),
      ]);
    }
    return program;
  }

  // tsc loads the types of a project only for a program that has a file.
  const empty: Sample = { page: "empty", line: 0, extension: ".ts", code: "", indentation: 0, fragment: false };
  const onlyTheTypes = check([empty]);
  const loadedByTheTypes = new Set(onlyTheTypes.getSourceFiles().map(file => file.fileName));
  errors.delete(empty);
  const importsAFile = (sample: Sample) =>
    ts.preProcessFile(sample.code).importedFiles.some(({ fileName }) => {
      const resolved = ts.resolveModuleName(fileName, fileOf(sample), options, host).resolvedModule;
      return resolved !== undefined && !loadedByTheTypes.has(resolved.resolvedFileName);
    });
  const alone = new Set(samples.filter(sample => declaresGlobals(sample) || importsAFile(sample)));
  check(samples.filter(sample => !alone.has(sample)));
  for (const sample of alone) check([sample]);
  return errors;
}

// A page does not show the whole program of each code block. What tsc reports for that reason is no failure:
const REST_OF_THE_PROGRAM = new Set([
  // a name that another part of the program declares,
  ...[2304, 2503, 2580, 2581, 2582, 2583, 2584, 2591, 2592, 2593, 2662, 2663, 18004],
  // a parameter whose type would come from such a name,
  ...[7006, 7019, 7031],
  // a `return` from a function that the code block is the body of,
  1108,
  // a name that two alternatives in one code block both declare,
  ...[1117, 2300, 2393, 2451, 2528],
  // and declarations that are listed without their bodies, or with their default values.
  ...[1015, 1155, 2371, 2390, 2391, 2564],
]);

/** What makes a sample fail: that it does not parse, or else what tsc reports beyond the rest of its program. */
function failuresOf(errors: SampleError[]) {
  const syntax = errors.filter(error => error.syntax);
  return syntax.length > 0 ? syntax.slice(0, 1) : errors.filter(error => !REST_OF_THE_PROGRAM.has(error.code));
}

const codesOf = (errors: SampleError[]) => [...new Set(errors.map(error => `TS${error.code}`))].sort();
const codesIn = (entry: string) => entry.split(" | ")[0].split(" ");

/** What the inventory says of a sample that fails: the codes, and the line of the first error for a reader. */
export function entryOf(errors: SampleError[]) {
  const failing = failuresOf(errors);
  if (failing.length > 0) return `${codesOf(failing).join(" ")} | ${failing[0].text}`;
}

function describeErrors(sample: Sample, errors: SampleError[]) {
  return errors.map(
    error =>
      `${sample.page}:${error.line}:${error.column} TS${error.code}: ${error.message.split("\n")[0]}\n    ${error.text}`,
  );
}

/**
 * Holds each sample to its marker, or with no marker to parse and to report nothing beyond the rest of its program.
 * A sample that the inventory lists may report the codes of its entry.
 *
 * Returns the failures, what the inventory lists and no sample reports, and the inventory without that.
 */
export function judge(samples: Sample[], errors: Map<Sample, SampleError[]>, inventory: Inventory) {
  const failures: string[] = [];
  const unused: string[] = [];
  const pruned: Inventory = {};
  const at = <V>(map: Map<string, Map<string, V>>, page: string) => map.get(page) ?? map.set(page, new Map()).get(page)!;

  // Per page, what each sample that fails with no marker would be listed as.
  const reports = new Map<string, Map<string, string>>();
  for (const sample of samples) {
    const entry = sample.fragment || sample.typeErrors ? undefined : entryOf(errors.get(sample)!);
    if (entry) at(reports, sample.page).set(keyOf(sample), entry);
  }
  // A page that moves takes its entries along: an entry whose page no longer has the sample covers the same sample
  // on one page that does not list it.
  const moved = new Map<string, { page: string; entry: string }[]>();
  for (const [page, listed] of Object.entries(inventory)) {
    for (const [key, entry] of Object.entries(listed)) {
      if (!reports.get(page)?.has(key)) moved.set(key, [...(moved.get(key) ?? []), { page, entry }]);
    }
  }
  const entries = new Map<string, Map<string, string>>();
  for (const [page, reported] of reports) {
    for (const key of reported.keys()) {
      const entry = inventory[page]?.[key] ?? moved.get(key)?.shift()?.entry;
      if (entry !== undefined) at(entries, page).set(key, entry);
    }
  }

  for (const sample of samples) {
    const { page } = sample;
    const reported = errors.get(sample)!;
    const failing = failuresOf(reported);
    if (sample.typeErrors) {
      // The code block may leave out the rest of its program, as one with no marker may. The marker may name the
      // code that tsc prints with a suggestion.
      const named = new Set(sample.typeErrors.map(code => WITHOUT_SUGGESTION.get(code) ?? code));
      const shown = reported.filter(error => named.has(error.code) || failing.includes(error));
      if (!Bun.deepEquals(codesOf(shown), [...named].map(code => `TS${code}`).sort())) {
        failures.push(
          `${page}:${sample.line}: the marker says ${sample.typeErrors.map(code => `TS${code}`).join(" ")}, tsc reports ${codesOf(shown).join(" ") || "nothing"}`,
          ...describeErrors(sample, shown),
        );
      }
    } else if (sample.fragment) {
      if (!reported.some(error => error.syntax)) {
        failures.push(`${page}:${sample.line}: the code block parses alone, so it needs no {/* fragment */}`);
      }
    } else if (failing.length > 0) {
      const entry = entries.get(page)?.get(keyOf(sample));
      const known = codesIn(entry ?? "");
      const added = failing.filter(error => !known.includes(`TS${error.code}`));
      if (entry !== undefined && added.length > 0) {
        failures.push(`${page}:${sample.line}: the inventory lists this code block with ${known.join(" ")}`);
      }
      failures.push(...describeErrors(sample, added));
    }
  }

  for (const [page, listed] of entries) {
    for (const [key, entry] of listed) {
      const now = reports.get(page)!.get(key)!;
      const still = codesIn(entry).filter(code => codesIn(now).includes(code));
      if (still.length < codesIn(entry).length) unused.push(`${page}: ${key} (${entry}): it reports ${now}`);
      if (still.length > 0) (pruned[page] ??= {})[key] = still.join(" ") + now.slice(now.indexOf(" | "));
    }
  }
  for (const [key, left] of moved) {
    for (const { page, entry } of left) unused.push(`${page}: ${key} (${entry}): no code block with this key fails`);
  }
  const sorted = Object.keys(pruned)
    .sort()
    .map(page => [page, Object.fromEntries(Object.entries(pruned[page]).sort(([a], [b]) => (a < b ? -1 : 1)))]);
  return { failures, unused, pruned: Object.fromEntries(sorted) as Inventory };
}
