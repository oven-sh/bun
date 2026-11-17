import { bunEnv, bunExe } from "harness";
import { cpus } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "../../../..");
export const files = [
  ...[
    "packages/bun-types/bun.d.ts",
    "test/js/bun/css/files/bulma.css",
    "packages/bun-inspector-protocol/src/protocol/v8/protocol.json",
    "bench/react-hello-world/react-hello-world.node.js",
    "test/js/bun/sqlite/northwind.testdb",
    "docs/images/cat.jpg",
  ].map(file => ({ file: join(root, file), skip: 0 })),
  { file: join(root, "src/bun.ico"), skip: 32768 },
  { file: bunExe(), skip: 20 << 20 },
];

export const machine = `${process.platform} ${process.arch} ${cpus()[0].model} x${cpus().length}`;

export const mean = (ratios: number[]) =>
  Math.exp(ratios.reduce((sum, ratio) => sum + Math.log(ratio), 0) / ratios.length);

export function start(exe: string) {
  const proc = Bun.spawn({
    cmd: [exe, join(import.meta.dir, "brotli-timing-fixture.mjs")],
    env: { ...bunEnv, BUN_GARBAGE_COLLECTOR_LEVEL: "0", BUN_JSC_randomIntegrityAuditRate: "0" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = proc.stdout.getReader();
  return {
    async time(cell: object): Promise<number[]> {
      proc.stdin.write(JSON.stringify(cell) + "\n");
      proc.stdin.flush();
      let text = "";
      while (!text.endsWith("\n")) text += Buffer.from((await reader.read()).value!).toString();
      return JSON.parse(text);
    },
    [Symbol.dispose]: () => proc.kill(),
  };
}

export async function compareSwitches(qualities: number[], sizes: number[][], switches: Record<string, number>) {
  const deadline = performance.now() + 90_000;
  using proc = start(bunExe());
  await proc.time({ ...files[0], size: 256, count: 64, quality: 1, masks: [0], rounds: 1, budget: 500 });
  const rows = Object.keys(switches).map(name => "TIMING " + name.padEnd(14));
  let head = "TIMING " + "".padEnd(14);
  for (const quality of qualities) {
    for (const [size, count, rounds] of sizes) {
      if (performance.now() > deadline) break;
      head += `q${quality}/${size}`.padStart(15);
      const ratios: number[][] = rows.map(() => []);
      for (const file of files) {
        const masks = [0, ...Object.values(switches)];
        const [plain, ...others] = await proc.time({ ...file, size, count, quality, masks, rounds, budget: 2 });
        others.forEach((time, i) => ratios[i].push(plain / time));
      }
      ratios.forEach((each, i) => {
        rows[i] += [mean(each), Math.min(...each), Math.max(...each)]
          .map(ratio => ratio.toFixed(2))
          .join("/")
          .padStart(15);
      });
    }
  }
  console.log([`TIMING ${machine}`, head, ...rows].join("\n"));
}
