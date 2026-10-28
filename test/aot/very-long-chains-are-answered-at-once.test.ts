import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

async function check(name: string, text: string) {
  using dir = tempDir("aot-long-chains", { [name]: text });
  const { stdout, stderr, exitCode } = await run([bunExe(), "check", "--aot", "--no-pretty", name], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  return { errors: [...(stdout + stderr).matchAll(/error (TS\d+)/g)].map(match => match[1]), exitCode };
}

const refused = { errors: ["TS100301"], exitCode: 1 };

describe.concurrent("very long chains", () => {
  for (const links of [2_100, 3_000, 10_000]) {
    test(`${links} optional accesses to a value of any type`, async () => {
      const text = `function f(o: any) { return o${"?.b".repeat(links)}; }\nconst o: any = {}; o.b = o;\nconsole.log(f(o) === o, f({}));\n`;
      expect(await check("main.ts", text)).toEqual(refused);
    }, 60_000);

    test(`${links} accesses in a file without types`, async () => {
      const text = `function f(o) { return o${".b".repeat(links)}; }\nconst o = {}; o.b = o;\nconsole.log(f(o) === o);\n`;
      expect(await check("main.js", text)).toEqual(refused);
    }, 60_000);

    test(`${links} calls of what the call before returns, in a file without types`, async () => {
      const text = `function f(g) { return g${"()".repeat(links)}; }\nconst g = () => g;\nconsole.log(f(g) === g);\n`;
      expect(await check("main.js", text)).toEqual(refused);
    }, 60_000);
  }

  test("a function of another file returns such a chain", async () => {
    using dir = tempDir("aot-long-chains", {
      "deep.js": `export function f(o) { return o${".b".repeat(10_000)}; }\n`,
      "main.js": `import { f } from "./deep.js";\nconst o = {}; o.b = o;\nconsole.log(f(o) === o, f(o).b === o);\n`,
    });
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "check", "--aot", "--no-pretty", "main.js"],
      String(dir),
      {
        ...bunEnv,
        NO_COLOR: "1",
      },
    );
    expect({ errors: [...(stdout + stderr).matchAll(/error (TS\d+)/g)].map(match => match[1]), exitCode }).toEqual(
      refused,
    );
  }, 60_000);

  test("1,900 accesses are compiled", async () => {
    const text = `function f(o) { return o${".b".repeat(1_900)}; }\nconst o = {}; o.b = o;\nconsole.log(f(o) === o);\n`;
    expect(await check("main.js", text)).toEqual({ errors: [], exitCode: 0 });
  }, 60_000);

  test("a conditional expression of 10,000 arms in a file without types", async () => {
    let arms = "";
    for (let arm = 0; arm < 10_000; arm++) arms += `a === ${arm} ? ${arm * 2} : `;
    using dir = tempDir("aot-long-chains", {
      "main.js": `function f(a) { return ${arms}-1; }\nconsole.log(f(9999), f(5000), f(0), f(-3));\n`,
    });
    const built = await run([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "main"], String(dir));
    expect({ stderr: built.exitCode ? built.stderr.slice(-1000) : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const { stdout, exitCode } = await run([`${dir}/main`], String(dir));
    expect({ stdout, exitCode }).toEqual({ stdout: "19998 10000 0 -1\n", exitCode: 0 });
  }, 120_000);
});
