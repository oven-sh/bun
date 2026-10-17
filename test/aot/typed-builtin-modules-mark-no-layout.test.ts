import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { unsupported } from "./run-programs";

const points = `interface Point { x: number; y: number }
const points: Point[] = [];
for (let i = 0; i < 3; i++) points.push({ x: i, y: i + 1 });
console.log(points.map(point => point.x + point.y).join());
`;

async function explained(source: string) {
  using dir = tempDir("aot-typed-builtin-modules-mark-no-layout", { "main.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "--aot-explain=mutations", "main.ts", "--outfile", "main"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = (stdout + stderr)
    .split("\n")
    .filter(line => line.includes("mutations: ") && line.includes("every layout: "));
  return {
    exitCode,
    kinds: lines.length,
    markEveryLayout: lines
      .filter(line => line.endsWith("nothing is said of an operand: true"))
      .map(line => line.replace(/^.*mutations: ([a-z ]+):.*$/, "$1")),
  };
}

test.skipIf(!!unsupported)(
  "a typed module of Bun marks no layout of the program where nothing is said of what it freezes or gives a prototype",
  async () => {
    expect(
      await explained(`import { EventEmitter } from "node:events";\nconsole.log(typeof EventEmitter);\n` + points),
    ).toEqual({ exitCode: 0, kinds: 2, markEveryLayout: [] });
  },
  120_000,
);

test.skipIf(!!unsupported)(
  "the program's own code does",
  async () => {
    expect(
      await explained(points + `const unknownValue: any = JSON.parse("{}");\nObject.freeze(unknownValue);\n`),
    ).toEqual({ exitCode: 0, kinds: 2, markEveryLayout: ["integrity level"] });
  },
  120_000,
);
