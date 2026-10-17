import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { slot, unsupported } from "../run-programs";

interface Program {
  road: string;
  spelling: string;
  extension: string;
  source: string;
  args: string[];
  env: Record<string, string>;
  stdin: string;
  buildFlags: string[];
  files: Record<string, string>;
  exitCode: number;
  todo?: string;
  refused?: string;
}

const folderOfRoads = join(import.meta.dir, "roads");

function programsOf(file: string): Program[] {
  const [road, extensionOfRoad] = file.split(".");
  const [prelude, ...sections] = readFileSync(join(folderOfRoads, file), "utf8").split(/^\/\/\/\/ *(.*)$/m);
  const programs: Program[] = [];
  for (let index = 0; index < sections.length; index += 2) {
    const source = prelude + sections[index + 1];
    const program: Program = { road, spelling: sections[index].trim(), extension: extensionOfRoad, source, args: [], env: {}, stdin: "", buildFlags: [], files: {}, exitCode: 0 };
    for (const [, directive, value] of source.matchAll(/^\/\/@ *(\S+) ?(.*)$/gm)) {
      if (directive === "args") program.args.push(...value.split(" "));
      else if (directive === "env") program.env[value.slice(0, value.indexOf("="))] = value.slice(value.indexOf("=") + 1);
      else if (directive === "stdin") program.stdin = JSON.parse(`"${value}"`);
      else if (directive === "build") program.buildFlags.push(...value.split(" "));
      else if (directive === "file") program.files[value.slice(0, value.indexOf(" "))] = JSON.parse(value.slice(value.indexOf(" ") + 1));
      else if (directive === "ext") program.extension = value;
      else if (directive === "exit") program.exitCode = Number(value);
      else if (directive === "todo") program.todo = value;
      else if (directive === "refused") program.refused = value;
      else throw new Error(`${file}: ${program.spelling}: unknown directive ${directive}`);
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
  if (program.refused !== undefined) {
    expect(build.stderr).toContain(program.refused);
    expect(build.exitCode).not.toBe(0);
    return undefined;
  }
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
  rmSync(join(folder, "cwd"), { recursive: true, force: true });
  mkdirSync(join(folder, "cwd"));
  for (const [path, text] of Object.entries(program.files)) if (path.startsWith("cwd/")) writeFileSync(join(folder, path), text);
  const ran = await run([join(folder, "program"), ...program.args], join(folder, "cwd"), { ...bunEnv, ...program.env }, program.stdin);
  rmSync(join(folder, "program"));
  return ran;
}

export function trimmedIsWhole(part: number, parts: number) {
  using probe = tempDir("trimmed-is-whole-probe", { "hello.ts": "console.log(1);" });
  const probed = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "hello.ts", "--outfile", "hello"],
    cwd: String(probe),
    env: bunEnv,
    stderr: "pipe",
  });
  const programs = readdirSync(folderOfRoads)
    .sort()
    .flatMap(programsOf)
    .filter((_, index) => index % parts === part - 1);

  (probed.exitCode !== 0 || unsupported || isWindows ? describe.skip : describe.concurrent)("an executable trimmed by its program's own facts behaves as the whole one", () => {
    for (const program of programs) {
      (program.todo ? test.todo : test)(
        `${program.road}: ${program.spelling}${program.todo ? ` (${program.todo})` : ""}`,
        () =>
          slot(async () => {
            using dir = tempDir("trimmed-is-whole", {
              [`program.${program.extension}`]: program.source,
              "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false, "allowJs": true } }`,
            });
            const folder = String(dir);
            for (const [path, text] of Object.entries(program.files)) {
              mkdirSync(dirname(join(folder, path)), { recursive: true });
              writeFileSync(join(folder, path), text);
            }
            const whole = await builtAndRun(program, folder, []);
            const trimmed = await builtAndRun(program, folder, ["--compile-trim-runtime"]);
            if (!whole) return;
            expect(whole.exitCode).toBe(program.exitCode);
            if (program.exitCode === 0) expect(whole.stdout).not.toBe("");
            expect(trimmed).toEqual(whole);
          }),
        600_000,
      );
    }
  });
}
