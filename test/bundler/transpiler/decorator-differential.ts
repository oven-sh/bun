// Compiles programs with TypeScript and runs them on Node, runs them on Bun, as they are or bundled, and compares what
// they log.
import { expect } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { tsc } from "../../cli/check/differential";

export type Case = {
  name: string;
  /** `main.ts` is the entry point. */
  files: Record<string, string>;
  /** In a matrix, member `m${index}` has the type `types[index]`. */
  types?: string[];
  /** On top of those of the test. */
  compilerOptions?: Record<string, unknown>;
  /** What it has to log. Only if what TypeScript compiles it to logs something else. */
  expected?: string[];
};

/** Every file starts with this. decorator-differential-fixture.js defines the globals. */
export const header = `declare const d: any, p: any, log: (line: string) => void, show: (...values: any[]) => void;\n`;

export function program(name: string, main: string, others: Record<string, string> = {}): Case {
  const files: Record<string, string> = { "main.ts": header + main };
  for (const [path, text] of Object.entries(others)) files[path] = path.endsWith(".ts") ? header + text : text;
  return { name, files };
}

export const canCompareWithTypeScript = !!tsc && !!nodeExe();

export type Difference = { name: string; typescript: string[]; bun: string[] };

export async function differencesFromTypeScript(
  cases: Case[],
  compilerOptions: Record<string, unknown>,
  { bundle = false } = {},
): Promise<Difference[]> {
  using dir = tempDir("decorator-differential", {});
  const root = String(dir);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };

  // Bun takes these options from the tsconfig.json of the directory it runs in, so each set of them has its own.
  const groups = [...new Set(cases.map(it => JSON.stringify(it.compilerOptions ?? {})))];
  const groupOf = (it: Case) => `${groups.indexOf(JSON.stringify(it.compilerOptions ?? {}))}`;
  const optionsOf = groups.map(group => ({
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    moduleDetection: "force",
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    resolveJsonModule: true,
    ...compilerOptions,
    ...JSON.parse(group),
  }));
  optionsOf.forEach((compilerOptions, group) => {
    write(join(root, "src", `${group}`, "tsconfig.json"), JSON.stringify({ compilerOptions }));
  });
  write(join(root, "out", "package.json"), `{ "type": "module" }`);

  // A program has no two files of one case, and a file that adds to the global scope is a program of its own.
  const programs = new Map<string, { group: string; files: string[] }>();
  cases.forEach((it, n) => {
    const group = groupOf(it);
    for (const [path, text] of Object.entries(it.files)) {
      write(join(root, "src", group, `${n}`, path), text);
      if (!path.endsWith(".ts")) {
        write(join(root, "out", group, `${n}`, path), text);
        continue;
      }
      const key = /declare (global|module)/.test(text) ? `${n}/${path}` : `${group}:${path}`;
      if (!programs.has(key)) programs.set(key, { group, files: [] });
      programs.get(key)!.files.push(`src/${group}/${n}/${path}`);
    }
  });
  await Promise.all(
    [...programs.values()].map(async ({ group, files }, n) => {
      const config = join(root, `tsconfig.${n}.json`);
      const isolated = { isolatedModules: true, noCheck: true, noResolve: true, noLib: true, types: [] };
      write(
        config,
        JSON.stringify({
          compilerOptions: { ...optionsOf[+group], ...isolated, rootDir: "src", outDir: "out" },
          files,
        }),
      );
      await using proc = Bun.spawn({ cmd: [tsc!, "-p", config], cwd: root, stdout: "ignore", stderr: "pipe" });
      // The exit code says whether the program has errors, and some cases do.
      expect(await proc.stderr.text()).toBe("");
    }),
  );

  /** What each of `numbers`, which are of one group, logs. */
  async function run(exe: string, directory: string, extension: string, numbers: number[]) {
    await using proc = Bun.spawn({
      cmd: [
        exe,
        join(import.meta.dir, "decorator-differential-fixture.js"),
        directory,
        extension,
        ...numbers.map(String),
      ],
      env: { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NODE_NO_WARNINGS: "1" },
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return (JSON.parse(stdout) as string[][]).map((lines, i) => [numbers[i], lines] as const);
  }
  async function runBundled(group: string, numbers: number[]) {
    const [source, bundled] = [join(root, "src", group), join(root, "bundled", group)];
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", `--root=${source}`, `--outdir=${bundled}`].concat(
        numbers.map(n => join(source, `${n}`, "main.ts")),
      ),
      env: bunEnv,
      cwd: source,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return await run(bunExe(), bundled, "js", numbers);
  }
  const workers = Math.min(8, availableParallelism());
  const runs = groups.flatMap((_, group) => {
    const numbers = cases.flatMap((it, n) => (groupOf(it) === `${group}` ? [n] : []));
    const length = Math.min(workers, Math.ceil(numbers.length / 16));
    const shares = Array.from({ length }, (_, share) => numbers.filter((_, i) => i % length === share));
    return {
      typescript: run(nodeExe()!, join(root, "out", `${group}`), "js", numbers),
      bun: shares.map(share =>
        bundle ? runBundled(`${group}`, share) : run(bunExe(), join(root, "src", `${group}`), "ts", share),
      ),
    };
  });
  const expected = new Map((await Promise.all(runs.map(it => it.typescript))).flat());
  const received = new Map((await Promise.all(runs.flatMap(it => it.bun))).flat());

  const differences: Difference[] = [];
  cases.forEach(({ name, files, types, expected: fixed }, n) => {
    const withType = (line: string) => line.replace(/\["m(\d+)"\]/, (_, index) => ` ${types?.[index]}:`);
    const [typescript, bun] = [fixed ?? expected.get(n)!, received.get(n)!];
    if (fixed?.join("\n") === expected.get(n)!.join("\n")) {
      differences.push({ name: `${name}: needs no \`expected\``, typescript: fixed, bun });
    }
    // With nothing to import, the file itself does not parse, and two such files compare nothing.
    if (Object.keys(files).length === 1 && typescript.join() === "throws SyntaxError") {
      differences.push({ name: `${name}: needs \`expected\``, typescript, bun });
    }
    if (typescript.join("\n") === bun.join("\n")) return;
    differences.push({
      name,
      typescript: typescript.filter((line, i) => line !== bun[i]).map(withType),
      bun: bun.filter((line, i) => line !== typescript[i]).map(withType),
    });
  });
  return differences;
}
