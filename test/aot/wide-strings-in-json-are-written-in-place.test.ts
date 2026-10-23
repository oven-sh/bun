// JSON.stringify of a typed value meets spread copies and untyped data. A 16-bit string in one of them keeps the call off the engine's slow path.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const rounds = 50;

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { typeRoots: [join(import.meta.dir, "../../packages")], types: ["bun-types"] },
  }),
  "main.ts": `
    interface Comment { id: number; body: string; at: Date }
    interface CommentNode extends Comment { replies: CommentNode[] }
    interface Thread { title: string; nodes: CommentNode[]; extra: unknown }
    const comments: Comment[] = [];
    for (let id = 0; id < 12; id++) comments.push({ id, body: id % 3 ? "plain " + id : "arrow \\u2192 " + id, at: new Date(1_700_000_000_000 + id * 86_400_123) });
    const nodes = comments.map((comment): CommentNode => ({ ...comment, replies: [{ ...comments[0], replies: [] }] }));
    const extra: unknown = process.argv[2] === "toJSON" ? { toJSON: () => "\\u2192" } : JSON.parse('{"text":"\\\\u2192","list":["a","\\\\u2192"]}');
    const thread: Thread = { title: "t", nodes, extra };
    const expected = JSON.stringify(thread, (key, value) => value);
    const written = (value: Thread) => JSON.stringify(value);
    let same = true;
    for (let round = 0; round < ${rounds}; round++) same &&= written(thread) === expected;
    console.log(same, expected.length);
    Bun.gc(true);
  `,
};

async function measure() {
  using dir = tempDir("aot-wide-strings-in-json", files);
  const cwd = String(dir);
  const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
  built(await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], cwd, bunEnv));

  const run = async (extra: string) => {
    const path = join(cwd, "counts-" + extra);
    const env = { ...bunEnv, BUN_JSC_aotCountsPath: path };
    const ran = await spawned([executable, extra], cwd, env);
    const areSame = ran.stdout.split(" ")[0];
    expect({ ...ran, stdout: areSame }).toEqual({ stdout: "true", stderr: "", exitCode: 0, signal: null });
    const entries = readFileSync(path, "utf8")
      .split("\n")
      .map(line => line.split("\t"));
    return entries.filter(([, name]) => name === "counter:JSONStringifySlowPaths").map(([count]) => Number(count));
  };
  return { wideStrings: await run("wide-strings"), toJSON: await run("toJSON") };
}

// The call with a replacer, which computes `expected`, takes the slow path once in every run.
describe("compile/aot/wide-strings-in-json", () => {
  let runs: Awaited<ReturnType<typeof measure>>;
  beforeAll(async () => {
    runs = await measure();
  }, 240_000);

  test("16-bit strings in generic values stay off the slow path", () => {
    expect(runs.wideStrings).toEqual([1]);
  });

  test("toJSON in a generic value is called without the slow path for the whole value", () => {
    expect(runs.toJSON).toEqual([1]);
  });
});
