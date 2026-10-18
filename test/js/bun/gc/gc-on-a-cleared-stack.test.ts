import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.gc(true) keeps nothing alive that only a frame that has returned knew", async () => {
  const source = `
    import { heapStats } from "bun:jsc";
    import { Database } from "bun:sqlite";
    const handles = () => heapStats().objectTypeCounts.SQLDatabase ?? 0;
    const left = [];
    Bun.gc(true);
    for (let count = 1; count <= 40; count++) {
      const held = (() => {
        const databases = [];
        for (let i = 0; i < count; i++) {
          const database = new Database(":memory:");
          database.close();
          databases.push(database);
        }
        return handles();
      })();
      Bun.gc(true);
      const collected = handles();
      if (held !== count || collected !== 0) left.push({ count, held, collected });
    }
    console.log(JSON.stringify(left));
  `;
  for (const env of [bunEnv, { ...bunEnv, BUN_JSC_useJIT: "0" }]) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", source], env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "[]", stderr: "", exitCode: 0 });
  }
});
