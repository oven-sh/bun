import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
  },
});

// Control flow leaves a `finally` block in three ways, and a walk back through it goes through the blocks nested in its
// `try` block once for each. TypeScript takes 3 to the power of n walks for n blocks. A walk that is given up answers with
// the declared type, which `++` does not take.
const depth = 60;
const source = `export function counts(): number {
  let count: number | string = 0;
${"  try {\n".repeat(depth)}  count++;
${"  } finally { count++; }\n".repeat(depth)}  return count;
}

export function narrows(): number {
  let value: string | number = "a";
${"  try {\n".repeat(depth)}  value = 1;
${"  } finally { value; }\n".repeat(depth - 1)}  } finally {
    const inBlock: number = value;
  }
  const behindBlock: number = value;
  return behindBlock;
}
`;

test("finally blocks nested in one another are checked at once", async () => {
  using dir = tempDir("check-nested-finally-blocks", { "tsconfig.json": tsconfig, "nested.ts": source });
  const { stdout, exitCode } = await run([bunExe(), "check", "./nested.ts"], String(dir));
  const errors = stdout.split("\n").filter(line => line.includes("error TS"));
  expect({ errors, exitCode }).toEqual({
    errors: [
      `nested.ts(${4 * depth + 10},11): error TS2322: Type 'string | number' is not assignable to type 'number'.`,
    ],
    exitCode: 1,
  });
});
