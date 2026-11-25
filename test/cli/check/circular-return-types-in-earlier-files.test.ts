// `wrap(f)(a)` in `f` leads back to the return type of `f` through the return type annotation of `wrap`. TypeScript reports TS2577 at that annotation. But it collects
// the errors of a file right after it has checked the file, so it never reports one that the check of a later file adds.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const compilerOptions = {
  strict: true,
  noEmit: true,
  target: "esnext",
  module: "esnext",
  moduleResolution: "bundler",
  lib: ["esnext"],
  types: [],
};
const wrap =
  "export declare function wrap<F extends (...a: any[]) => any>(f: F): (...a: Parameters<F>) => ReturnType<F>;\n";
const implicit = (name: string) =>
  `error TS7023: '${name}' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.`;
const circular = "error TS2577: Return type annotation circularly references itself.";

test.concurrent.each([
  [
    "in an earlier file",
    { "m.ts": `import { wrap } from "./h";\nexport function f(a: any) { return wrap(f)(a); }\n`, "h.ts": wrap },
    [`m.ts(2,17): ${implicit("f")}`],
  ],
  [
    "in the same file",
    { "m.ts": wrap + "export function f(a: any) { return wrap(f)(a); }\n" },
    [`m.ts(1,94): ${circular}`, `m.ts(2,17): ${implicit("f")}`],
  ],
  [
    "in a later file",
    {
      "m.ts": `import { f } from "./n";\n${wrap}export const q: string = f(1);\n`,
      "n.ts": `import { wrap } from "./m";\nexport function f(a: any) { return wrap(f)(a); }\n`,
    },
    [`m.ts(2,94): ${circular}`, `n.ts(2,17): ${implicit("f")}`],
  ],
  [
    "in a file before two that lead to each other",
    {
      "m.ts": `import { wrap } from "./h";\nimport { g } from "./n";\nexport function f(a: any) { return wrap(g)(a); }\n`,
      "n.ts": `import { wrap } from "./h";\nimport { f } from "./m";\nexport function g(a: any) { return wrap(f)(a); }\n`,
      "h.ts": wrap,
    },
    [`m.ts(3,17): ${implicit("f")}`, `n.ts(3,17): ${implicit("g")}`],
  ],
] as const)("%s", async (_, files, expected) => {
  using dir = tempDir("check-circular-return-types", {
    "tsconfig.json": JSON.stringify({ compilerOptions, files: ["m.ts"] }),
    ...files,
  });
  for (const threads of [1, 2, 8]) {
    const { stdout } = await run([bunExe(), "check", "--no-pretty", `--threads=${threads}`, "-p", "."], String(dir), {
      ...bunEnv,
      NO_COLOR: "1",
    });
    expect(
      stdout
        .split("\n")
        .filter(line => line.includes("error TS"))
        .sort(),
    ).toEqual([...expected]);
  }
});
