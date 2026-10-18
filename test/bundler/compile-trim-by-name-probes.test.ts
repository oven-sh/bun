import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { doorsPath, readTrimFeatures, removedOnlyWith } from "../../scripts/build/trim-features";
import { spawned } from "../aot/run-programs";

const doors = readFileSync(doorsPath, "utf8");
const all = readTrimFeatures(doors);
const descriptions = doors
  .split("\n")
  .filter(line => line.startsWith("feature "))
  .map(line => line.split(" ").slice(2).join(" "));

const program = `
  const { absent, throws }: { absent: string[]; throws: string[] } = JSON.parse(process.argv[2] ?? '{ "absent": [], "throws": [] }');
  const at = (path: string) => path.split(".").reduce((value: any, key) => value[key], globalThis);
  const roots = ["globalThis", "Bun", "Intl", "Temporal", "crypto", "process", "console", "performance"];
  const surface: string[] = [];
  for (const name of roots) {
    const root = name === "globalThis" ? globalThis : (globalThis as any)[name];
    const keys = new Set<string>();
    for (let each = root; each && each !== Object.prototype; each = Object.getPrototypeOf(each))
      for (const key of Reflect.ownKeys(each)) if (typeof key === "string") keys.add(key);
    for (const key of keys) surface.push([name === "globalThis" ? key : name + "." + key, key in root, typeof root[key]].join(" "));
  }
  const probes = absent.map(path => [path, typeof at(path), at(path) === undefined ? "falls back" : "goes on"].join(" "));
  const calls = throws.map(path => {
    try {
      at(path)();
      return path + " returned";
    } catch (error) {
      return [path, (error as Error).name, (error as { code?: string }).code, (error as Error).message].join(" | ");
    }
  });
  const printed = [Bun, globalThis, Intl, crypto].map(each => Bun.inspect(each).length > 0);
  console.log(JSON.stringify({ surface, probes, calls, printed }));
`;

type Answer = { surface: string[]; probes: string[]; calls: string[]; printed: boolean[] };

async function answerOf(folder: string, outfile: string, compile: object, handles: { absent: string[]; throws: string[] }) {
  await Bun.build({ entrypoints: [join(folder, "program.ts")], compile: { outfile: join(folder, outfile, "program"), ...compile } });
  const { stdout, stderr, exitCode } = await spawned([join(folder, outfile, "program"), JSON.stringify(handles)], folder, bunEnv);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return JSON.parse(stdout) as Answer;
}

async function hasIslands() {
  using dir = tempDir("compile-trim-by-name-probes", { "program.ts": `console.log("hello world");` });
  try {
    await Bun.build({ entrypoints: [join(String(dir), "program.ts")], compile: { outfile: join(String(dir), "program"), trim: true } });
    return true;
  } catch {
    return false;
  }
}

const featuresOf = (name: string) => all.names.find(each => each.name === name)!.features;
const runTheProgramItself = new Set(doors.split("\n").flatMap(line => (line.startsWith("when ") && line.endsWith(" world open") ? [line.split(" ")[1]!] : [])));
const startsPrograms = new Set(all.names.find(each => each.name === "spawn")?.throws);
const cases = all.names
  .map(each => {
    const names = [each.name, ...removedOnlyWith(all, each)];
    const gone = new Set(names.flatMap(featuresOf));
    const removed = all.names.filter(other => other.features.every(feature => gone.has(feature)));
    return { name: each.name, names, needsCompiledProgram: [...gone].some(feature => runTheProgramItself.has(feature)), absent: [...new Set(removed.flatMap(other => other.absent))], throws: [...new Set(removed.flatMap(other => other.throws))].filter(path => !startsPrograms.has(path)) };
  })
  .filter(each => each.absent.length + each.throws.length > 0);

describe.skipIf(isWindows || !(await hasIslands()))("a program may ask for what compile.trim removed by name", () => {
  const whole: Partial<Record<"plain" | "aot", string[]>> = {};

  beforeAll(async () => {
    using dir = tempDir("compile-trim-by-name-probes", { "program.ts": program });
    whole.plain = (await answerOf(String(dir), "whole", {}, { absent: [], throws: [] })).surface;
    whole.aot = (await answerOf(String(dir), "whole-aot", { aot: true }, { absent: [], throws: [] })).surface;
  }, 120_000);

  const check = async (kind: "plain" | "aot", { names, absent, throws }: (typeof cases)[number]) => {
    using dir = tempDir("compile-trim-by-name-probes", { "program.ts": program });
    const answer = await answerOf(String(dir), "trimmed", { aot: kind === "aot", trim: names }, { absent, throws });
    expect(answer.probes).toEqual(absent.map(path => `${path} undefined falls back`));
    expect(answer.calls.map(call => call.split(" | ").slice(0, 3).join(" | "))).toEqual(throws.map(path => `${path} | Error | ERR_FEATURE_REMOVED`));
    for (const call of answer.calls) expect(descriptions.map(description => `compile.trim removed ${description} from this executable`)).toContain(call.split(" | ")[3]!);
    expect(answer.printed).toEqual([true, true, true, true]);
    const changed = answer.surface.filter((line, index) => line !== whole[kind]![index]);
    expect(answer.surface.length).toBe(whole[kind]!.length);
    expect(changed.toSorted()).toEqual(absent.map(path => `${path} true undefined`).sort());
  };

  test.concurrent.each(cases.filter(each => !each.needsCompiledProgram).map(each => [each.name, each] as const))("%s", async (_, each) => check("plain", each), 120_000);

  test.concurrent.each(cases.filter(each => each.needsCompiledProgram || ["html-rewriter", "sql", "intl", "hash", "web-crypto"].includes(each.name)).map(each => [each.name, each] as const))(
    "%s, compiled ahead of time",
    async (_, each) => check("aot", each),
    120_000,
  );
});
