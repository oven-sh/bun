// Some file of a test run writes a source file of the project, so that file and every file above it may run again, and each run keeps the variables of its scope to
// itself. A test that walks a heap snapshot from the module loader for a variable of such a file found it on the scope of a closure, or on a cell of a class of the
// compiler's own that the walk does not enter. So was the scope of a call that a function stores into, which such a walk knows by its class and by the scope that it leads on to.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "table.ts": `export const TABLE = [1, 2, 3];\n`,
  "made.ts": `
    import { TABLE } from "./table.ts";
    export const make = <K, V>() => Object.defineProperty(new Map<K, V>(), "made", { value: TABLE.length });`,
  "holder.ts": `
    import { make } from "./made.ts";
    const drawers = make<number, string>();
    const shelves = new Map<number, string>();
    let boxes: Map<number, string> | null = null;
    const crates = new Map<number, string>();
    export function put(key: number, value: string): number {
      drawers.set(key, value);
      shelves.set(key, value);
      (boxes ??= new Map()).set(key, value);
      return drawers.size + shelves.size + boxes.size;
    }
    export const count = () => shelves.size + drawers.size;
    export const stack = (() => {
      const pallets = new Map<number, string>();
      let bins: Map<number, string> | null = null;
      return (key: number) => pallets.set(key, "").size + crates.set(key, "").size + (bins ??= new Map()).set(key, "").size;
    })();`,
  "apart.ts": `
    const trays = new Map<number, number>();
    export const lay = (key: number) => trays.set(key, key).size;`,
  "walk.ts": `
    import { generateHeapSnapshotForDebugging } from "bun:jsc";
    const names = ["drawers", "shelves", "boxes", "crates", "pallets", "bins", "trays"];
    export function look(): string {
      const raw: any = generateHeapSnapshotForDebugging();
      const classOf = new Map<number, string>();
      for (let i = 0; i < raw.nodes.length; i += 7) classOf.set(raw.nodes[i], raw.nodeClassNames[raw.nodes[i + 2]]);
      const out = new Map<number, [number, string, string][]>();
      for (let i = 0; i < raw.edges.length; i += 4) {
        const type = raw.edgeTypes[raw.edges[i + 2]];
        let list = out.get(raw.edges[i]);
        if (!list) out.set(raw.edges[i], (list = []));
        list.push([raw.edges[i + 1], type, type === "Variable" ? raw.edgeNames[raw.edges[i + 3]] : ""]);
      }
      const owned = new Set<number>();
      for (const [id, name] of classOf) if (name === "ModuleLoader") owned.add(id);
      const queue = [...owned];
      const entered = /^(ModuleLoader|ModuleRegistryEntry|ModuleRecord|JSModuleEnvironment|ModuleNamespaceObject|JSLexicalEnvironment)$/;
      for (let head = 0; head < queue.length; head++)
        for (const [to, type] of out.get(queue[head]!) ?? [])
          if (type === "Internal" && entered.test(classOf.get(to)!) && !owned.has(to)) { owned.add(to); queue.push(to); }
      const seen: string[] = [];
      for (const [from, list] of out)
        for (const [to, type, name] of list)
          if (type === "Variable" && names.includes(name) && classOf.get(to) === "Map")
            seen.push(name + " in a " + classOf.get(from) + (owned.has(from) ? " under the loader" : list.some(([next, kind]) => kind === "Internal" && owned.has(next)) ? " over such a scope" : ""));
      return seen.sort().join(" . ");
    }`,
  "walk.test.ts": `
    import { test } from "bun:test";
    import { writeFileSync } from "fs";
    import { lay } from "./apart.ts";
    import { count, put, stack } from "./holder.ts";
    import { look } from "./walk.ts";
    export function rewrite(): void {
      writeFileSync(import.meta.dir + "/table.ts", "export const TABLE = [1, 2, 3];\\n");
    }
    test("a variable of a file is a variable of its scope", () => {
      console.error("OUT", put(1, "a"), count(), stack(1), lay(1));
      console.error("OUT", look());
    });`,
};

async function linesOf(flags: string[]) {
  using dir = tempDir("aot-variables-of-a-file-that-may-run-again", files);
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "./walk.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => /^(OUT|error)/.test(line)), exitCode };
}

test("each hangs once on the scope of its module, which the loader leads to", async () => {
  const [plain, compiled] = await Promise.all([linesOf([]), linesOf(["--aot"])]);
  expect(plain).toEqual({
    lines: [
      "OUT 3 2 3 1",
      "OUT bins in a JSLexicalEnvironment over such a scope . " +
        ["boxes", "crates", "drawers"].map(name => name + " in a JSModuleEnvironment under the loader").join(" . ") +
        " . pallets in a JSLexicalEnvironment over such a scope . " +
        ["shelves", "trays"].map(name => name + " in a JSModuleEnvironment under the loader").join(" . "),
    ],
    exitCode: 0,
  });
  expect(compiled).toEqual(plain);
}, 240_000);
