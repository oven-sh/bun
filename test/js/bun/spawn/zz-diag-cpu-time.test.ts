// Diagnostic only: the raw CPU times Windows reports for child processes.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

test.skipIf(!isWindows)("zz diag: raw cpuTime of child processes", async () => {
  const lines: string[] = [];
  const usage = async (label: string, cmd: string[], cwd?: string) => {
    await using proc = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    const { user, system, total } = proc.resourceUsage()!.cpuTime;
    lines.push(
      `DIAG ${label}: user ${user} system ${system} total ${total} us; total / 15625 = ${Number(total) / 15625}`,
    );
  };
  for (const ms of [0, 3, 7, 12, 20, 33, 47, 61, 90, 140])
    for (let run = 0; run < 3; run++)
      await usage(`spin ${ms} ms`, [
        bunExe(),
        "-e",
        `for (const end = performance.now() + ${ms}; performance.now() < end; );`,
      ]);
  const source = (n: number) => `
    import { useState } from "react";
    export function App() {
      const [s] = useState(0);
      const f0 = () => s;
      ${Array.from({ length: n }, (_, i) => `const f${i + 1} = () => f${i};`).join("\n")}
      return <div onClick={f${n}} />;
    }
  `;
  using dir = tempDir("zz-diag-cpu-time", { "n.jsx": source(200), "2n.jsx": source(400) });
  for (let run = 0; run < 6; run++)
    for (const entry of ["n.jsx", "2n.jsx"])
      await usage(
        `compile ${entry}`,
        [bunExe(), "build", "--react-compiler", "--target=browser", "--external=*", entry],
        String(dir),
      );
  expect(lines.join("\n")).toBe("");
});
