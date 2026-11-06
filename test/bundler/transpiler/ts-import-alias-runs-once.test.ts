import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

test.concurrent.each([
  [
    "a namespace of the file",
    `namespace local { export type T = number; export const v = 1; }
import T = local.T;
import v = local.v;
const t: T = v;
console.log("ran", t);
`,
  ],
  [
    "an imported namespace object",
    `import * as lib from "./lib";
import T = lib.T;
import v = lib.v;
const t: T = v;
console.log("ran", t);
`,
  ],
  [
    "a global namespace",
    `import Options = Intl.NumberFormatOptions;
import NumberFormat = Intl.NumberFormat;
const options: Options = {};
console.log("ran", new NumberFormat("en-US", options).format(1));
`,
  ],
])("a file with a used and an unused `import a = b.c` runs once: %s", async (_name, entry) => {
  using dir = tempDir("ts-import-alias-runs-once", {
    "lib.ts": `export type T = number;\nexport const v = 1;\n`,
    "entry.ts": entry,
  });

  const { stdout, stderr, exitCode } = await run([bunExe(), "entry.ts"], String(dir));

  expect(stderr).toBe("");
  expect(stdout).toBe("ran 1\n");
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  [
    "only a type names an alias of a namespace body",
    `namespace N { export type T = number; }
namespace M {
  import T = N.T;
  export const x: T = 1;
}
console.log(M.x);
`,
    "1\n",
  ],
  [
    "only an alias that is not read names an alias at module scope",
    `declare namespace D { namespace Inner { type T = number; } }
import Inner = D.Inner;
namespace M {
  import T = Inner.T;
  const y: T = 2;
  export const x = y;
}
console.log(M.x);
`,
    "2\n",
  ],
  [
    "only an alias of a namespace body names an import",
    `import { Missing } from "./lib";
namespace M {
  import T = Missing.T;
  export const x: T = 1;
}
console.log(M.x);
`,
    "lib\n1\n",
  ],
  [
    "a function that runs first reads an alias of an enum member",
    `enum E { A = 1 }
namespace M {
  export const x = f();
  import A = E.A;
  function f() { return A; }
}
console.log(M.x);
`,
    "1\n",
  ],
])("an `import a = b.c` that no value reads is not evaluated: %s", async (_name, entry, expected) => {
  using dir = tempDir("ts-import-alias-not-read", {
    "lib.ts": `console.log("lib");\nexport type T = number;\n`,
    "entry.ts": entry,
  });

  const { stdout, stderr, exitCode } = await run([bunExe(), "entry.ts"], String(dir));

  expect(stderr).toBe("");
  expect(stdout).toBe(expected);
  expect(exitCode).toBe(0);
});
