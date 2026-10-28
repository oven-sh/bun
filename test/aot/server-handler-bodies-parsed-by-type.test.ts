import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { built } from "./run-programs";
import { test } from "./supported-with-counted-calls";

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { typeRoots: [join(import.meta.dir, "../../packages")], types: ["bun-types"] },
  }),
  "main.ts": `
    interface Order { id: number; items: string[] }
    const server = Bun.serve({
      port: 0,
      async fetch(request: Request): Promise<Response> {
        const order = (await request.json()) as Order;
        return new Response(String(order.id + order.items.length));
      },
    });
    const answers: string[] = [];
    for (let round = 0; round < Number(process.argv[2]); round++) {
      const response = await fetch(server.url, { method: "POST", body: JSON.stringify({ id: round, items: ["a", "b"] }) });
      answers.push(await response.text());
    }
    console.log(answers.join(" "));
    await server.stop(true);
  `,
};

test("an async handler of Bun.serve parses the body of each request into the declared type", async () => {
  using dir = tempDir("aot-server-typed-bodies", files);
  const cwd = String(dir);
  const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
  built(await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], cwd, bunEnv));

  const typedParses = async (rounds: number, stdout: string) => {
    const path = join(cwd, "counts" + rounds);
    const env = { ...bunEnv, BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds)], cwd, env)).toEqual({ stdout, stderr: "", exitCode: 0 });
    const entries = readFileSync(path, "utf8")
      .split("\n")
      .map(line => line.split("\t"));
    return entries
      .filter(([, name]) => name === "operation:operationAOTJSONSourceOpen")
      .map(([count]) => Number(count));
  };

  expect(await typedParses(2, "2 3\n")).toEqual([2]);
  expect(await typedParses(5, "2 3 4 5 6\n")).toEqual([5]);
}, 240_000);
