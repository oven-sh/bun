import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("importing .txt files should not parse backslashes", () => {
  const result = spawnSync({
    cmd: [bunExe(), join(import.meta.dir, "03449-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  expect(result.stdout.toString()).toBe(`.|...\\....
|.-.\\.....
.....|-...
........|.
..........
.........\\
..../.\\\\..
.-.-/..|..
.|....-|.\\
..//.|....`);
  expect(result.exitCode).toBe(0);
});
