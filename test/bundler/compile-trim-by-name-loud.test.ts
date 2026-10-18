import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { doorsPath, readTrimFeatures, removedOnlyWith } from "../../scripts/build/trim-features";
import { spawned } from "../aot/run-programs";

const doors = readFileSync(doorsPath, "utf8");
const all = readTrimFeatures(doors);
const descriptions = new Map(
  doors
    .split("\n")
    .filter(line => line.startsWith("feature "))
    .map(line => [line.split(" ")[1]!, line.split(" ").slice(2).join(" ")] as const),
);

const folder = join(import.meta.dir, "compile-trim-runtime-by-use");
const shared = readdirSync(folder)
  .filter(file => file.endsWith(".ts"))
  .sort()
  .map(file => {
    const name = basename(file, ".ts");
    const options: { features?: string[]; build?: string[]; env?: Record<string, string>; posix?: boolean } = existsSync(join(folder, name + ".json"))
      ? JSON.parse(readFileSync(join(folder, name + ".json"), "utf8"))
      : {};
    return { source: readFileSync(join(folder, file), "utf8"), features: options.features ?? [name.replaceAll("-", "_")], ...options };
  })
  .filter(program => !program.build);

const own: Record<string, string> = {
  bundler: `console.log((await Bun.build({ entrypoints: ["./empty"], target: "bun" })).success);`,
  inspector: `
    const inspector = require("node:inspector");
    inspector.open(0, "127.0.0.1");
    console.log(typeof inspector.url());
    inspector.close();
  `,
  "html-rewriter": `console.log(await new HTMLRewriter().transform(new Response("<p>hello</p>")).text());`,
  ffi: `console.log(typeof require("bun:ffi").dlopen);`,
  "intl-segmenter": `console.log([...new Intl.Segmenter("en", { granularity: "word" }).segment("a b")].length);`,
  color: `console.log(Bun.color("red", "hex"));`,
};

const conditions = doors.split("\n").filter(line => line.startsWith("when "));
const reachedByPrograms = new Set(conditions.map(line => line.split(" ")[1]!));
const runTheProgramItself = new Set(conditions.filter(line => line.endsWith(" world open")).map(line => line.split(" ")[1]!));
const cases = all.names
  .filter(each => each.features.some(feature => reachedByPrograms.has(feature)) && !each.features.some(feature => runTheProgramItself.has(feature)))
  .map(each => ({ ...each, program: own[each.name] ? { source: own[each.name]!, features: each.features } : shared.find(program => program.features.some(feature => each.features.includes(feature))) }));

test("every public name has a program that uses it", () => {
  expect(cases.filter(each => !each.program).map(each => each.name)).toEqual([]);
});

async function hasIslands() {
  using dir = tempDir("compile-trim-by-name-probe", { "hello.ts": `console.log("hello world");` });
  try {
    await Bun.build({ entrypoints: [join(String(dir), "hello.ts")], compile: { outfile: join(String(dir), "hello"), trim: true } });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!(await hasIslands()))("a program that uses what compile.trim removed by name is told so", () => {
  test.concurrent.each(cases.filter(each => each.program && !(isWindows && each.program.posix)).map(each => [each.name, each] as const))(
    "%s",
    async (name, { features, program, ...rest }) => {
      using dir = tempDir("compile-trim-by-name-loud", { "program.ts": program!.source, "cwd/empty": "" });
      const env = { ...bunEnv, ...program!.env };
      const built = async (outfile: string, trim: Bun.Build.TrimFeature[]) => {
        await Bun.build({ entrypoints: [join(String(dir), "program.ts")], compile: { outfile: join(String(dir), outfile, "program"), trim } });
        return await spawned([join(String(dir), outfile, "program")], join(String(dir), "cwd"), env);
      };
      expect(await built("whole", [])).toMatchObject({ exitCode: 0 });
      const names = [name, ...removedOnlyWith(all, { name, features, ...rest })] as Bun.Build.TrimFeature[];
      const refused = await built("trimmed", names).catch(error => {
        expect((error as AggregateError).errors[0].message).toStartWith("compile.trim: what is named is too small");
        return built("trimmed", [...names, "cli"]);
      });
      const removed = /^error: compile\.trim removed (.*) from this executable, and something has just asked for it\.\n$/.exec(refused.stderr)?.[1];
      expect({ stderr: refused.stderr, isOfThisName: features.some(feature => descriptions.get(feature) === removed) }).toEqual({ stderr: refused.stderr, isOfThisName: true });
      expect(refused.exitCode).toBe(70);
    },
    120_000,
  );
});
