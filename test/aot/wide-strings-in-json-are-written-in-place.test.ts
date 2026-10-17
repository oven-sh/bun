// JSON.stringify of a typed value hands objects made by a spread and untyped data to the runtime's writer. A string there that does
// not fit in 8 bits used to make that writer give up, and with it the whole call: the answer was then written again from the start.
import { expect } from "bun:test";
import { test } from "./supported";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const files = {
  "tsconfig.json": JSON.stringify({ compilerOptions: { typeRoots: [join(import.meta.dir, "../../packages")], types: ["bun-types"] } }),
  "main.ts": `
    interface Comment { id: number; body: string; at: Date }
    interface CommentNode extends Comment { replies: CommentNode[] }
    interface Thread { title: string; nodes: CommentNode[]; extra: unknown }
    const comments: Comment[] = [];
    for (let id = 0; id < 12; id++) comments.push({ id, body: id % 3 ? "plain " + id : "arrow \\u2192 " + id, at: new Date(1_700_000_000_000 + id * 86_400_123) });
    const nodes = comments.map((comment): CommentNode => ({ ...comment, replies: [{ ...comments[0], replies: [] }] }));
    const thread: Thread = { title: "t", nodes, extra: JSON.parse('{"text":"\\\\u2192","list":["a","\\\\u2192"]}') };
    const expected = JSON.stringify(thread, (key, value) => value);
    const written = (value: Thread) => JSON.stringify(value);
    let same = true;
    for (let round = 0; round < 50; round++) same &&= written(thread) === expected;
    console.log(same, expected.length);
    Bun.gc(true);
  `,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test("a 16-bit string in a part that is handed over does not send the call the slow way round", async () => {
  using dir = tempDir("aot-wide-strings-in-json", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const path = join(String(dir), "counts");
  const env = { ...bunEnv, BUN_JSC_useAOTOperationCounters: "1", BUN_JSC_aotTypeCoverageCountsPath: path };
  const ran = await run([executable], String(dir), env);
  expect({ ...ran, stdout: ran.stdout.split(" ")[0] }).toEqual({ stdout: "true", stderr: "", exitCode: 0 });
  const reasons: string[] = [];
  for (const line of existsSync(path + ".guests") ? readFileSync(path + ".guests", "utf8").split("\n") : []) {
    const [, kind, reason] = line.split("\t");
    if (kind === "JSON.stringify-fast-way-gives-up") reasons.push(reason);
  }
  expect(reasons.sort()).toEqual(["replacer"]);
}, 240_000);
