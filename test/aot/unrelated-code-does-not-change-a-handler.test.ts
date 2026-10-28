// How the handlers of a small server are compiled depends on the handlers and on what they call, not on how much code there is
// elsewhere in the program that seldom runs: the handlers are hot, and a body is parsed by the type it is given.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { test } from "./supported";

setDefaultTimeout(240_000);

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    typeRoots: [join(import.meta.dir, "..", "..", "packages")],
    types: ["bun-types"],
  },
});

const app = join(import.meta.dir, "servers", "app");
const server = readFileSync(join(app, "api-bun.ts"), "utf8");
const store = readFileSync(join(app, "api-store.ts"), "utf8");

function seldomRunCode(statements: number): string {
  if (!statements) return "";
  const lines = Array.from(
    { length: statements },
    (_, index) =>
      `  if (sum === ${index + 1} * 1000003) { try { sum += String(sum * ${index + 1}).length; } catch { sum -= ${index + 1}; } }`,
  );
  return `
function seldom(start: number): number {
  let sum = start;
${lines.join("\n")}
  return sum;
}
if (process.argv.length > 50) console.log(seldom(process.argv.length));
`;
}

/** Name, role, position, size and heat of every compiled function of the server, and how many bodies are parsed by their type. */
async function compile(statements: number) {
  using folder = tempDir("aot-unrelated-code", {
    "main.ts": server + seldomRunCode(statements),
    "api-store.ts": store,
    "tsconfig.json": tsconfig,
  });
  const [report, map] = ["report.json", "main.map"].map(name => join(String(folder), name));
  const executable = join(String(folder), isWindows ? "main.exe" : "main");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", "--aot-report=" + report, "./main.ts", "--outfile", executable],
      String(folder),
      { ...bunEnv, BUN_JSC_aotMapFilePath: map },
    ),
  );
  const functions = readFileSync(map, "utf8")
    .split("\n")
    .map(line => line.split("\t"))
    .filter(fields => fields[0] === "F" && /(main|api-store)\.ts$/.test(fields[10] ?? "") && fields[7] !== "seldom")
    // The module's own code calls seldom().
    .filter(fields => fields[7] !== "")
    .map(fields => `${fields[7]} ${fields[8]} ${fields[11]}: ${fields[3]} bytes, ${fields[12]}`)
    .sort();
  return {
    functions,
    bodiesParsedByType: JSON.parse(readFileSync(report, "utf8")).statistics.TypedResultsSelected as number,
  };
}

const handlers = ["/health", "/api/projects/:projectId/tasks/:taskId", "GET", "POST", "fetch"];

test("the handlers of a server are hot beside 0, 20, 100 and 400 statements that seldom run", async () => {
  for (const { functions, bodiesParsedByType } of await Promise.all([0, 20, 100, 400].map(compile))) {
    expect(bodiesParsedByType).toBe(1);
    for (const handler of handlers) {
      const heat = new Set(functions.filter(line => line.startsWith(handler + " ")).map(line => line.at(-1)));
      expect({ handler, heat: [...heat] }).toEqual({ handler, heat: ["h"] });
    }
  }
});

// TODO: what the handlers call is hot or warm by its share of the program, so two handlers differ by a few bytes.
test.todo(
  "every function of a server has the same size beside 0, 20, 100 and 400 statements that seldom run",
  async () => {
    const [alone, ...others] = await Promise.all([0, 20, 100, 400].map(compile));
    expect(alone.functions.length).toBeGreaterThan(10);
    for (const other of others) expect(other).toEqual(alone);
  },
);
