import { profileStartup } from "./measure-startup";

const [scenario, ...programs] = process.argv.slice(2);
const env = { ...process.env, BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1" };

type Symbols = { addresses: Float64Array; names: string[] };

function readSymbols(executable: string): Symbols {
  const lines = Bun.spawnSync({ cmd: ["nm", "-n", "-C", "--defined-only", executable], stdout: "pipe", stderr: "ignore" }).stdout.toString().split("\n");
  const symbols = lines.map(line => /^([0-9a-f]+) [tTwW] (.*)$/.exec(line)).filter(match => match !== null);
  return { addresses: Float64Array.from(symbols, match => parseInt(match[1], 16)), names: symbols.map(match => match[2]) };
}

async function instructionsByFunction(executable: string): Promise<Map<string, number>> {
  const { addresses, names } = readSymbols(executable);
  const { instructions, maps } = await profileStartup({ command: [executable, scenario], env });
  const mappings = maps
    .split("\n")
    .map(line => /^([0-9a-f]+)-([0-9a-f]+) \S+ ([0-9a-f]+) \S+ \S+\s*(.*)$/.exec(line))
    .filter(match => match !== null)
    .map(match => ({ start: parseInt(match[1], 16), end: parseInt(match[2], 16), path: match[4] }));
  const runtimeEnd = Math.max(...mappings.filter(mapping => mapping.path === executable && mapping.start < 0x100000000).map(mapping => mapping.end));
  const result = new Map<string, number>();
  for (const [address, count] of instructions) {
    let name: string;
    if (address < runtimeEnd) {
      let low = 0,
        high = addresses.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (addresses[middle] <= address) low = middle + 1;
        else high = middle;
      }
      name = low ? names[low - 1] : "?";
    } else {
      const mapping = mappings.find(mapping => mapping.start <= address && address < mapping.end);
      name = mapping?.path === executable ? "[compiled code]" : `[${mapping?.path.split("/").at(-1) || "anonymous memory"}]`;
    }
    result.set(name, (result.get(name) ?? 0) + count);
  }
  return result;
}

const [first, second] = await Promise.all(programs.map(instructionsByFunction));
const total = (profile: Map<string, number>) => [...profile.values()].reduce((sum, count) => sum + count, 0);
if (second) {
  console.log(`${total(first)} -> ${total(second)} instructions`);
  const growth = [...new Set([...first.keys(), ...second.keys()])].map(name => [name, (second.get(name) ?? 0) - (first.get(name) ?? 0)] as const);
  for (const [name, grown] of growth.sort((a, b) => b[1] - a[1]).filter(([, grown]) => grown)) console.log(`${String(grown).padStart(10)}  ${String(first.get(name) ?? 0).padStart(10)}  ${name}`);
} else {
  console.log(`${total(first)} instructions`);
  for (const [name, count] of [...first].sort((a, b) => b[1] - a[1])) console.log(`${String(count).padStart(10)}  ${name}`);
}
