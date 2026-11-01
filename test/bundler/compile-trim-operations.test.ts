// --compile --aot, with and without --trim: compiled code calls the run time through a table of operations. An image lists the ones that it uses, and an executable keeps the families
// of those alone: FOR_EACH_AOT_OPERATION_IN_FAMILY in the engine's aot/runtime/AOTRuntimeTable.h.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";
import { spawned, unsupported } from "../aot/harness/commands";
import { readRemovedFeatures } from "../aot/trimmed-against-whole/removed-features";
import { canTrim, model, saysFeatureWasRemoved, tempDirForAotBuilds, withoutFeatures } from "./compile-trim-features";

const families = model.features.filter(each => each.enteredFrom === "compiled-code");
const namesOfRemovedFamilies = (executable: string) => {
  const removed = new Set(readRemovedFeatures(executable));
  return families.filter(each => removed.has(each.index)).map(each => each.name);
};

const files = {
  "hello.ts": `console.log("hello world");`,
  "uses-many.ts": `
    console.log("started");
    class Account {
      #balance = 0;
      deposit(amount: number) {
        this.#balance += amount;
        return this;
      }
      get balance() {
        return this.#balance;
      }
    }
    function* upTo(limit: number) {
      for (let i = 0; i < limit; i++) yield i;
    }
    const argument: unknown = JSON.parse(process.argv[2] ?? '{ "list": [3, 1, 2], "name": "n" }');
    const given = argument as { list: number[]; name: string };
    const counts = new Map<string, number>();
    for (const each of given.list) counts.set("k" + each, each);
    counts.delete("k1");
    const seen = new Set(given.list);
    seen.clear();
    const copy = { ...given, more: true };
    const removed = given.list.splice(1, 1);
    delete (copy as { name?: string }).name;
    console.log(
      JSON.stringify({
        balance: new Account().deposit(2).deposit(3).balance,
        generated: [...upTo(3)],
        counts: [...counts],
        seen: seen.size,
        keys: Object.keys(copy),
        removed,
        awaited: await Promise.all([1, Promise.resolve(2)]),
        padded: given.name.padStart(3, "-"),
        bytes: [...new Uint8Array([1, 2, 3]).subarray(1)],
      }),
    );
  `,
};
const outputOfUsesMany =
  'started\n{"balance":5,"generated":[0,1,2],"counts":[["k3",3],["k2",2]],"seen":0,"keys":["list","more"],"removed":[1],"awaited":[1,2],"padded":"--n","bytes":[2,3]}\n';

describe.skipIf(!canTrim || !!unsupported).each([[[] as string[]], [["--trim"]]])(
  "the run-time operations of an executable built with %j",
  trim => {
    async function build(cwd: string, name: string, flags: string[] = []) {
      const cmd = [bunExe(), "build", "--compile", "--aot", ...trim, ...flags, `${name}.ts`, "--outfile", name];
      const { stderr, exitCode } = await spawned(cmd, cwd, bunEnv);
      expect(stderr).not.toMatch(/^error\b/m);
      expect(exitCode).toBe(0);
      return join(cwd, name + (isWindows ? ".exe" : ""));
    }

    test("hello world keeps no family", async () => {
      using dir = tempDirForAotBuilds("compile-trim-operations", files);
      const hello = await build(String(dir), "hello");
      expect(families.length).toBeGreaterThan(30);
      expect(namesOfRemovedFamilies(hello)).toEqual(families.map(each => each.name));
      expect(await spawned([hello], String(dir), bunEnv)).toMatchObject({ stdout: "hello world\n", exitCode: 0 });
    }, 600_000);

    test("a program keeps the families of what its image lists", async () => {
      using dir = tempDirForAotBuilds("compile-trim-operations", files);
      const executable = await build(String(dir), "uses-many");
      const removed = namesOfRemovedFamilies(executable);
      expect(removed).toContain("OperationsOfChecks");
      expect(removed).not.toContain("OperationsOnMapsAndSets");
      expect(await spawned([executable], String(dir), bunEnv)).toMatchObject({ stdout: outputOfUsesMany, exitCode: 0 });
    }, 600_000);

    // The list decides, so this cannot come about by itself. Were it to, the program would end wherever it first calls what is gone.
    test("an image that lists an operation of a family that is gone does not start", async () => {
      using dir = tempDirForAotBuilds("compile-trim-operations", files);
      const executable = await build(String(dir), "uses-many", withoutFeatures(["OperationsOnMapsAndSets"]));
      expect(namesOfRemovedFamilies(executable)).toContain("OperationsOnMapsAndSets");
      const { stdout, stderr, exitCode } = await spawned([executable], String(dir), bunEnv);
      expect(stdout).toBe("");
      expect(saysFeatureWasRemoved(stderr, "OperationsOnMapsAndSets")).toBe(true);
      expect(exitCode).toBe(70);
    }, 600_000);
  },
);
