import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

test("`require.main === module` keeps its parentheses inside a larger expression", async () => {
  using dir = tempDir("require-main-in-an-expression", {
    "main.cjs": `console.log("main: " + (require.main === module) + ".");
console.log("main: " + (module === require.main) + ".");
console.log("main: " + (require.main == module) + ".");
console.log("not main: " + (require.main !== module) + ".");
console.log(1 + (require.main === module), typeof (require.main === module), !(require.main === module));
console.log((require.main === module).toString(), (require.main !== module).toString());
console.log((require.main === module) === true, (require.main === module) + "" === "true");
console.log((require.main === module) ? "yes" : "no", (require.main === module) && "and", (require.main !== module) || "or");
if (require.main === module) console.log("the statement as it is usually written");
`,
  });
  const { stdout, stderr, exitCode } = await run([bunExe(), "main.cjs"], String(dir));
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: `main: true.
main: true.
main: true.
not main: false.
2 boolean false
true false
true true
yes and or
the statement as it is usually written
`,
    stderr: "",
    exitCode: 0,
  });
});
