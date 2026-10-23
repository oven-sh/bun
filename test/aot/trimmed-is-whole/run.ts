import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canTrim, featureOf, model } from "../../bundler/compile-trim-features";
import { inShare, slot, unsupported } from "../run-programs";
import { readRemovedFeatures } from "../trimmed-against-whole/removed-features";

interface Program {
  group: string;
  name: string;
  extension: string;
  source: string;
  args: string[];
  env: Record<string, string>;
  stdin: string;
  buildFlags: string[];
  files: Record<string, string>;
  exitCode: number;
  todo?: string;
  buildError?: string;
  evaluatedCodeUsesRemovedApi: boolean;
  /** The build does not see that the call reaches an evaluator, or the script of the Worker is a text: both executables end with the same EvalError. */
  isNotSeen: boolean;
  removes: string[];
  trimmedSays?: string;
}

const casesFolder = join(import.meta.dir, "cases");

function programsOf(file: string): Program[] {
  const [group, defaultExtension] = file.split(".");
  const [prelude, ...sections] = readFileSync(join(casesFolder, file), "utf8").split(/^\/\/\/\/ *(.*)$/m);
  const programs: Program[] = [];
  for (let index = 0; index < sections.length; index += 2) {
    const source = prelude + sections[index + 1];
    const program: Program = { group, name: sections[index].trim(), extension: defaultExtension, source, args: [], env: {}, stdin: "", buildFlags: [], files: {}, exitCode: 0, evaluatedCodeUsesRemovedApi: false, isNotSeen: false, removes: [] };
    for (const [, directive, value] of source.matchAll(/^\/\/@ *(\S+) ?(.*)$/gm)) {
      if (directive === "args") program.args.push(...value.split(" "));
      else if (directive === "env") program.env[value.slice(0, value.indexOf("="))] = value.slice(value.indexOf("=") + 1);
      else if (directive === "stdin") program.stdin = JSON.parse(`"${value}"`);
      else if (directive === "build") program.buildFlags.push(...value.split(" "));
      else if (directive === "file") program.files[value.slice(0, value.indexOf(" "))] = JSON.parse(value.slice(value.indexOf(" ") + 1));
      else if (directive === "ext") program.extension = value;
      else if (directive === "exit") program.exitCode = Number(value);
      else if (directive === "todo") program.todo = value;
      else if (directive === "build-error") program.buildError = value;
      else if (directive === "evaluated-code-uses-removed-api") program.evaluatedCodeUsesRemovedApi = true;
      else if (directive === "not-seen") program.isNotSeen = true;
      else if (directive === "removes") program.removes.push(value);
      else if (directive === "trimmed-says") program.trimmedSays = value;
      else throw new Error(`${file}: ${program.name}: unknown directive ${directive}`);
    }
    programs.push(program);
  }
  return programs;
}

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>, stdin = "") {
  await using child = Bun.spawn({ cmd, cwd, env, stdin: Buffer.from(stdin), stdout: "pipe", stderr: "pipe", timeout: 90_000, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode, signal: child.signalCode };
}

async function builtAndRun(program: Program, folder: string, flags: string[]) {
  const entry = `program.${program.extension}`;
  const build = await run([bunExe(), "build", "--compile", "--aot", ...flags, entry, ...program.buildFlags, "--outfile", "program"], folder, bunEnv);
  if (program.buildError !== undefined) {
    expect(build.stderr).toContain(program.buildError);
    expect(build.exitCode).not.toBe(0);
    return undefined;
  }
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
  rmSync(join(folder, "cwd"), { recursive: true, force: true });
  mkdirSync(join(folder, "cwd"));
  for (const [path, text] of Object.entries(program.files)) if (path.startsWith("cwd/")) writeFileSync(join(folder, path), text);
  const ran = await run([join(folder, "program"), ...program.args], join(folder, "cwd"), { ...bunEnv, ...program.env }, program.stdin);
  const removed = readRemovedFeatures(join(folder, "program")) ?? [];
  rmSync(join(folder, "program"));
  return { ran, removed };
}

const color = model.features.find(feature => feature.name === featureOf("Bun.color"))!.index;

export function testTrimmedMatchesUntrimmed(part: number, parts: number) {
  const programs = readdirSync(casesFolder)
    .sort()
    .flatMap(programsOf)
    .filter((_, index) => index % parts === part - 1)
    .filter(program => inShare(`trimmed matches untrimmed ${program.group}: ${program.name}`, 4, true));

  (!canTrim || unsupported || isWindows ? describe.skip : describe.concurrent)("an executable built with --trim behaves like one built without it", () => {
    for (const program of programs) {
      (program.todo ? test.todo : test)(
        `${program.group}: ${program.name}${program.todo ? ` (${program.todo})` : ""}${program.evaluatedCodeUsesRemovedApi ? " (if --trim removed the API that the evaluated code calls, the call throws a catchable error)" : ""}`,
        () =>
          slot(async () => {
            using dir = tempDir("trimmed-is-whole", {
              [`program.${program.extension}`]: program.source,
              "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false, "allowJs": true, "types": ["bun"], "skipLibCheck": true } }`,
            });
            const folder = String(dir);
            for (const [path, text] of Object.entries(program.files)) {
              mkdirSync(dirname(join(folder, path)), { recursive: true });
              writeFileSync(join(folder, path), text);
            }
            const untrimmed = (await builtAndRun(program, folder, []))?.ran;
            const { ran: trimmed, removed } = (await builtAndRun(program, folder, ["--trim"])) ?? {};
            if (!untrimmed) return;
            if (program.isNotSeen) {
              expect({ exitCode: untrimmed.exitCode, stdout: untrimmed.stdout, says: untrimmed.stderr.includes("the compiler couldn't tell at build time that this call reaches eval() or the Function constructor") }).toEqual({ exitCode: 1, stdout: "", says: true });
              return expect(trimmed).toEqual(untrimmed);
            }
            expect(untrimmed).toMatchObject({ exitCode: program.exitCode });
            if (program.exitCode === 0) expect(untrimmed.stdout).not.toBe("");
            const stillThere = program.removes.filter(api => !removed!.includes(model.features.find(feature => feature.name === featureOf(api))!.index));
            expect(stillThere).toEqual([]);
            if (program.trimmedSays !== undefined) {
              expect(untrimmed.stdout + untrimmed.stderr).not.toContain(program.trimmedSays);
              return expect(trimmed!.stdout + trimmed!.stderr).toContain(program.trimmedSays);
            }
            if (!program.evaluatedCodeUsesRemovedApi || !removed!.includes(color)) return expect(trimmed).toEqual(untrimmed);
            expect(untrimmed).toEqual({ stdout: "#ff0000 function\n", stderr: "", exitCode: 0, signal: null });
            const isThrown = /^\w*rror: .*\bBun\.color\b.*\n code: "ERR_FEATURE_REMOVED"$/m.test(trimmed!.stderr);
            expect({ signal: trimmed!.signal, exitCode: trimmed!.exitCode, stdout: trimmed!.stdout, isThrown }).toEqual(
              program.source.includes('"caught"') ? { signal: null, exitCode: 0, stdout: "caught ERR_FEATURE_REMOVED\n", isThrown: false } : { signal: null, exitCode: 1, stdout: "", isThrown: true },
            );
          }),
        600_000,
      );
    }
  });
}
