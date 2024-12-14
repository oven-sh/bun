import { describe, test, expect } from "bun:test" with { todo: "true" };
import { bunEnv, tempDirWithFiles } from "harness";

/*
Potential solutions:
- Option 1: Make a fake export `export const my_string = undefined;` and make sure it is not enumerable
- Option 2: In b.ts, make javascriptcore skip re-exporting something if it is not found rather than SyntaxErroring
  - this won't work because in the import {} export {} case, the error will be on the import
*/

const a_file = `
  export type my_string = "1";

  export type my_value = "2";
  export const my_value = "2";

  export const my_only = "3";
`;
const a_no_value = `
  export type my_string = "1";
  export type my_value = "2";
  export const my_only = "3";
`;
const a_with_value = `
  export type my_string = "1";
  export const my_value = "2";
`;
const b_files = [
  {
    name: "export from",
    value: `export { my_string, my_value, my_only } from "./a.ts";`,
  },
  {
    name: "import then export",
    value: `
      import { my_string, my_value, my_only } from "./a.ts";
      export { my_string, my_value, my_only };
    `,
  },
  {
    name: "export star",
    value: `export * from "./a.ts";`,
  },
  {
    name: "export merge",
    value: `export * from "./a_no_value.ts"; export * from "./a_with_value.ts"`,
  },
];
const c_files = [
  { name: "require", value: `console.log(JSON.stringify(require("./b")));` },
  { name: "import star", value: `import * as b from "./b"; console.log(JSON.stringify(b));` },
  { name: "await import", value: `console.log(JSON.stringify(await import("./b")));` },
  {
    name: "import individual",
    value: `
      import { my_string, my_value, my_only } from "./b";
      console.log(JSON.stringify({ my_only, my_value }));
    `,
  },
];
for (const b_file of b_files) {
  describe(`re-export with ${b_file.name}`, () => {
    for (const c_file of c_files) {
      describe(`import with ${c_file.name}`, () => {
        const dir = tempDirWithFiles("type-export", {
          "a.ts": a_file,
          "b.ts": b_file.value,
          "c.ts": c_file.value,

          "a_no_value.ts": a_no_value,
          "a_with_value.ts": a_with_value,
        });

        const runAndVerify = (filename: string) => {
          const result = Bun.spawnSync({
            cmd: ["bun", "run", filename],
            cwd: dir,
            env: bunEnv,
            stdio: ["inherit", "pipe", "inherit"],
          });

          expect(result.exitCode).toBe(0);
          expect(JSON.parse(result.stdout.toString().trim())).toEqual({ my_value: "2", my_only: "3" });
        };

        test.todoIf(b_file.name !== "export star" && b_file.name !== "export merge")("run", () => {
          runAndVerify("c.ts");
        });

        test("build", async () => {
          const result = Bun.spawnSync({
            cmd: ["bun", "build", "--target=bun", "--outfile", "bundle.js", "c.ts"],
            cwd: dir,
            env: bunEnv,
            stdio: ["inherit", "inherit", "inherit"],
          });

          expect(result.exitCode).toBe(0);
          runAndVerify("bundle.js");
        });
      });
    }
  });
}
