// Tables of small programs that are written by the scripts in ./made: `python3 <topic>.py <folder>` writes one folder a case (its entry
// point is the file named main) or one file a case, and the top of each script says what its cases are about. Three of the scripts write one random program for a seed. Each case is run three ways, as ./run-three-ways.ts says, and
// ./made/<topic>.json holds the verdict of each case in which the three do not all agree. A verdict that changes fails the test, for better or for worse.
// AOT_PROGRAMS_UPDATE=1 rewrites the file.
//
//   bun test test/aot/made-cases-three-ways                      the cases in which --aot is alone, and one in ten of the others, others for each commit of Bun
//   AOT_GENERATED=all bun test test/aot/made-cases-three-ways    all
//   AOT_GENERATED=<text> bun test test/aot/made-cases-three-ways those whose name contains the text
import { spawnSync } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tempDir } from "harness";
import { join, relative } from "path";
import { inShare, wanted as programsWanted, slot, takesWhatIsFixed, unsupported } from "../run-programs";
import { judged } from "./run-three-ways";

const python = Bun.which("python3");
if (!python) console.error("SKIPPED: test/aot/made-cases-three-ways: python3 is not installed");
const updates = !!process.env.AOT_PROGRAMS_UPDATE;
const wanted = process.env.AOT_GENERATED ?? "";

function filesUnder(folder: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) files[relative(folder, join(entry.parentPath, entry.name))] = readFileSync(join(entry.parentPath, entry.name), "utf8");
  }
  return files;
}

/** Some cases print hundreds of lines: the first lines of --aot that are not those of `bun run`, and how many there are. */
function whereItDeparts(aot: string, plain: string) {
  const theirs = plain.split("\n");
  const lines = aot.split("\n").filter((line, i) => line !== theirs[i]);
  // A long number is a time or an address. A case may cut a message in the middle of the path of the temporary folder.
  return [...lines.slice(0, 4).map(line => line.replaceAll("program.exe", "program").replace(/B:\\~BUN\\root[^\s"']*/g, path => "/$bunfs/root" + path.slice(12).replaceAll("\\", "/")).replaceAll("\\r\\n", "\\n").slice(0, 160).replace(/\d{10,}/g, "<number>").replace(/Cannot load '(?:\/|[A-Z]:\\)[^']*/g, "Cannot load '<path>")), ...(lines.length > 4 ? [`and ${lines.length - 4} lines more`] : [])].join("\n");
}

/**
 * `without`: cases that do not end, in plain Bun or in the executable of `bun build --compile`, or whose build depends on which type declarations lie above the temporary folder.
 * `seeds`: the script writes one random program, `<topic>.py <seed> <folder>`, and the cases are those of the seeds from 1 up to this.
 */
function madeCases(topic: string, { without = [], seeds = 0 }: { without?: string[]; seeds?: number } = {}) {
  const recorded = join(import.meta.dir, "made", `${topic}.json`);
  const verdicts: Record<string, string> = existsSync(recorded) ? JSON.parse(readFileSync(recorded, "utf8")) : {};
  const found: Record<string, string> = {};
  const root = String(tempDir("aot-made-cases", {}));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    const departing = Object.entries({ ...verdicts, ...found }).filter(([, verdict]) => verdict !== "all agree");
    if (updates) writeFileSync(recorded, JSON.stringify(Object.fromEntries(departing.sort(([a], [b]) => (a < b ? -1 : 1))), null, 1) + "\n");
  }, 300_000);
  describe.concurrent(`compile/aot/made cases/${topic.replaceAll("-", " ")}`, () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    if (!python) return void test.skip("python3 is not installed", () => {});
    for (const words of seeds ? Array.from({ length: seeds }, (_, i) => [String(i + 1), join(root, "made", `seed-${String(i + 1).padStart(3, "0")}`)]) : [[join(root, "made")]]) {
      const made = spawnSync({ cmd: [python, "-B", join(import.meta.dir, "made", `${topic}.py`), ...words], env: { ...process.env, PYTHONUTF8: "1" }, stdout: "ignore", stderr: "pipe" });
      if (made.exitCode !== 0) throw new Error(`${topic}.py: ${made.stderr}`);
    }
    // A case that has no tsconfig.json of its own gets the options and the types of ../programs. Without this, whether a folder above the temporary folder holds node_modules/@types would decide what TypeScript says of it.
    mkdirSync(join(root, "run"), { recursive: true });
    const compilerOptions = { target: "esnext", module: "preserve", moduleResolution: "bundler", allowImportingTsExtensions: true, allowJs: true, resolveJsonModule: true, noEmit: true, typeRoots: [join(import.meta.dir, "..", "..", "..", "packages")], types: ["bun-types"] };
    writeFileSync(join(root, "run", "tsconfig.json"), JSON.stringify({ compilerOptions }));
    const written = readdirSync(join(root, "made"), { withFileTypes: true });
    const alone = Object.fromEntries(written.filter(entry => entry.isFile()).map(entry => [entry.name, readFileSync(join(root, "made", entry.name), "utf8")]));
    const stem = (file: string) => file.replace(/(\.d)?\.[a-z]+$/, "");
    const filesNamedIn = (text: string) => Object.keys(alone).filter(file => text.includes(`"./${stem(file)}`));
    // A file that another one imports is no case of its own: it goes with each case that names it.
    const imported = new Set(Object.entries(alone).flatMap(([file, text]) => filesNamedIn(text).filter(other => stem(other) !== stem(file))));
    const cases: Record<string, () => Record<string, string>> = {};
    for (const entry of written) {
      // A few folders hold test files for `bun test` and have no program to build.
      if (entry.isDirectory() && readdirSync(join(root, "made", entry.name)).some(file => /^main\.[a-z]+$/.test(file))) cases[entry.name] = () => filesUnder(join(root, "made", entry.name));
      else if (entry.isFile() && /(?<!\.d)\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) && !imported.has(entry.name))
        cases[stem(entry.name)] = () => ({ ...Object.fromEntries(filesNamedIn(alone[entry.name]).map(file => [file, alone[file]])), [entry.name.replace(/^.*(?=\.[a-z]+$)/, "main")]: alone[entry.name] });
    }
    const names = Object.keys(cases)
      .sort()
      .filter(name => !without.includes(name));
    const chosen = names.filter(name =>
      wanted === "all" || updates ? true : wanted ? `${topic} ${name}`.includes(wanted) : programsWanted === "quick" ? inShare(`${topic} ${name}`, 50, true) : (takesWhatIsFixed && verdicts[name]?.startsWith("alone")) || inShare(`${topic} ${name}`, 10),
    );
    if (chosen.length === 0) test.skip("no case selected", () => {});
    for (const name of chosen) {
      test(
        name,
        () =>
          slot(async () => {
            const { plain, bundle, aot, ...whole } = await judged(join(root, "run", name), cases[name]());
            // A random program in which a module throws while it is loaded is held to nothing: how far the others get differs from machine to machine.
            const fails = seeds > 0 && /(^|\n)exit code \d+/.test(plain);
            const verdict = fails ? "it fails in plain Bun" : whole.verdict.startsWith("alone: ") ? "alone: " + whereItDeparts(aot, plain) : whole.verdict;
            if (updates) found[name] = verdict;
            // How many calls fit on the stack differs from build to build, and with it whether the three stop at the same call.
            const mayAgree = name.startsWith("at-the-stacks-end-") && verdict === "all agree";
            expect({ verdict, plain, bundle }).toEqual({ verdict: updates || mayAgree ? verdict : (verdicts[name] ?? "all agree"), plain, bundle });
          }),
        600_000,
      );
    }
  });
}

const options: Record<string, Parameters<typeof madeCases>[1]> = {
  "buffer-statics-partial-objects-host-records": { without: ["response-json-of-records"] },
  "random-commonjs-and-esm": { seeds: 30 },
  "random-commonjs-and-esm-with-hooks": { seeds: 30 },
  "random-esm-namespace-as-value": { seeds: 30 },
  "top-level-symbols": { without: ["a-worker-has-its-own"] },
  "values-of-another-realm": { without: ["a-promise-of-another-realm"] },
};

export function madeCasesOfAllTopics(part: number, parts: number) {
  const topics = readdirSync(join(import.meta.dir, "made")).flatMap(file => (file.endsWith(".py") ? file.slice(0, -3) : []));
  for (const [index, topic] of topics.sort().entries()) if (index % parts === part - 1) madeCases(topic, options[topic]);
}
