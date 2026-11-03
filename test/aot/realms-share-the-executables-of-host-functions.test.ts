import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const makers = `
  import { heapStats } from "bun:jsc";
  import { createContext, runInContext, runInNewContext } from "node:vm";

  const makers: Record<string, () => (text: string) => any> = {
    runInNewContext: () => runInNewContext("text => (0, eval)(text)", {}),
    createContext: () => {
      const context = createContext({});
      return text => runInContext(text, context);
    },
  };

  function countExecutables(): number {
    Bun.gc(true);
    return heapStats().objectTypeCounts.NativeExecutable;
  }
`;

const files = {
  "count.ts": `
    ${makers}
    for (const [name, make] of Object.entries(makers)) {
      const kept = [make(), make()];
      for (const evaluate of kept) evaluate("[3, 1, 2].sort().join() + JSON.stringify(Object.keys({ a: 1 }))");
      const before = countExecutables();
      for (let i = 0; i < 100; i++) {
        const evaluate = make();
        evaluate("[3, 1, 2].sort().join() + JSON.stringify(Object.keys({ a: 1 }))");
        kept.push(evaluate);
      }
      console.log(name + " " + Math.floor((countExecutables() - before) / 100) + " " + kept.length);
    }
  `,
  "answers.ts": `
    ${makers}
    const describe = \`
      [Array.prototype.push, Array.isArray, Math.max, Object, Promise.prototype.then, parseInt, Object.getOwnPropertyDescriptor(Map.prototype, "size").get]
        .map(f => f.name + " " + f.length + " " + String(f)).join("; ")\`;
    for (const [name, make] of Object.entries(makers)) {
      const first = make();
      const second = make();
      console.log(name + ": " + first(describe));
      console.log(first(describe) === second(describe), first(describe) === (0, eval)(describe));
      for (const path of ["Array.prototype.concat", "Array.of", "Object.create", "Promise.resolve"]) {
        const [mine, theirs, others] = [(0, eval)(path), first(path), second(path)];
        console.log(path, mine === theirs, theirs === others, theirs === first(path));
      }
      console.log(first("Array.of").call(undefined, 1) instanceof first("Array"), first("Array.of").call(undefined, 1) instanceof Array);
      console.log(first("Array.prototype.concat").call([1], [2]) instanceof Array);
      console.log(Object.getPrototypeOf(first("Object.fromEntries")([])) === first("Object.prototype"));
      try {
        first("Array.prototype.push").call(null);
      } catch (error) {
        console.log(error instanceof first("TypeError"), error instanceof second("TypeError"), error instanceof TypeError);
      }
      first("Math").max.own = 1;
      console.log(first("Math.max.own"), second("Math.max.own"), (Math.max as any).own);
    }
  `,
  "dropped.ts": `
    ${makers}
    const before = countExecutables();
    for (let round = 0; round < 12; round++) {
      let text = "";
      for (const make of Object.values(makers)) {
        for (let i = 0; i < 5; i++) text += make()("[3, 1, 2].sort().join('') + Math.max(1, 2) + String(parseInt).length");
      }
      console.log(text);
      await new Promise(resolve => setTimeout(resolve, 1));
      countExecutables();
    }
    console.log(countExecutables() - before < 1000);
  `,
};

async function build(dir: string, program: string): Promise<string> {
  const executable = join(dir, program);
  const built = await run([bunExe(), "build", "--compile", "--aot", program + ".ts", "--outfile", executable], dir);
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  return executable;
}

test("a realm behind the second makes no executable for a host function that an earlier one has made", async () => {
  using dir = tempDir("aot-realms-share-executables", files);
  const ran = await run([await build(String(dir), "count")], String(dir), bunEnv);
  expect(ran).toEqual({
    stdout: "runInNewContext 0 102\ncreateContext 0 102\n",
    stderr: "",
    exitCode: 0,
  });
}, 240_000);

test.each(["answers", "dropped"])(
  "host functions of several realms answer as without --aot: %s",
  async program => {
    using dir = tempDir("aot-realms-share-executables", files);
    const expected = await run([bunExe(), "run", program + ".ts"], String(dir), bunEnv);
    expect(expected.exitCode).toBe(0);
    expect(await run([await build(String(dir), program)], String(dir), bunEnv)).toEqual(expected);
  },
  240_000,
);
