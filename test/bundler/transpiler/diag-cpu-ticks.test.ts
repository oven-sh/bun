// Diagnostic, not for merging: what resourceUsage().cpuTime.total reads on Windows for the chain of functions builds.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

test.skipIf(!isWindows)(
  "cpu time of the chain of functions builds, in 1/64 s",
  async () => {
    const component = (name: string, n: number) => `
    export function ${name}() {
      const [s] = useState(0);
      const f0 = () => s;
      ${Array.from({ length: n }, (_, i) => `const f${i + 1} = () => f${i};`).join("\n")}
      return <div onClick={f${n}} />;
    }
  `;
    const source = (n: number, components: number) => `
    import { useState } from "react";
    ${Array.from({ length: components }, (_, i) => component("App" + i, n)).join("\n")}
  `;
    const lines: string[] = [];
    for (const components of [1, 8, 16]) {
      using dir = tempDir("diag-cpu-ticks", { "n.jsx": source(200, components), "2n.jsx": source(400, components) });
      const cpuTime = async (entry: string) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "build", "--react-compiler", "--target=browser", "--external=*", entry],
          env: bunEnv,
          cwd: String(dir),
          stdout: "ignore",
          stderr: "ignore",
        });
        await proc.exited;
        return Number(proc.resourceUsage()!.cpuTime.total);
      };
      const small: number[] = [];
      const large: number[] = [];
      for (let i = 0; i < 12; i++) {
        large.push((await cpuTime("2n.jsx")) / 15625);
        small.push((await cpuTime("n.jsx")) / 15625);
      }
      const ratios = large.map((l, i) => l / small[i]);
      lines.push(
        `${components} components: n ${small.join(" ")} | 2n ${large.join(" ")} | ratios ${Math.min(...ratios).toFixed(2)}..${Math.max(...ratios).toFixed(2)}`,
      );
    }
    expect(lines.join("\n")).toBe("");
  },
  600_000,
);
