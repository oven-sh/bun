// Run by heap.test.ts: two call sites that a sourcemap maps to one position are one sample.
import { decode } from "./pprof-decode";

const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function vlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    const digit = rest & 31;
    rest >>>= 5;
    out += base64[rest ? digit | 32 : digit];
  } while (rest);
  return out;
}
// One segment per generated line: column 0 -> that line of source 0, column 0.
function mappings(originalLines: (number | null)[]): string {
  let previous = 0;
  return originalLines
    .map(line => {
      if (line === null) return "";
      const segment = vlq(0) + vlq(0) + vlq(line - previous) + vlq(0);
      previous = line;
      return segment;
    })
    .join(";");
}

// What a bundler would have made of a loop: "// @bun" has the runtime read the map of a file it does not transpile.
const generated = [
  "// @bun",
  "const kept = [];",
  "export function folded() {",
  "  kept.push(new ArrayBuffer(2 * 1024 * 1024));",
  "  kept.push(new ArrayBuffer(2 * 1024 * 1024));",
  "}",
];
const map = {
  version: 3,
  sources: ["folded-original.ts"],
  sourcesContent: [""],
  names: [],
  mappings: mappings([null, 0, 8, 9, 9, 10]),
};
const url = "data:application/json;base64," + Buffer.from(JSON.stringify(map)).toString("base64");
await Bun.write("folded-generated.js", generated.join("\n") + "\n//# sourceMappingURL=" + url + "\n");
const { folded } = await import("./folded-generated.js");

Bun.pprof.heap.start();
for (let i = 0; i < 16; i++) folded();
const profile = decode(Bun.pprof.heap.stop());

const samples = profile.samples.filter(s => s.stack.some(f => f.function === "folded"));
const key = (s: (typeof samples)[number]) =>
  JSON.stringify([
    s.labels,
    s.stack.map(f =>
      f.address !== undefined ? String(f.address) : [f.function, f.file, f.startLine, f.line, f.column],
    ),
  ]);
const frames = samples.map(s => s.stack.find(f => f.function === "folded")!);
console.log(
  JSON.stringify({
    repeated: samples.length - new Set(samples.map(key)).size,
    allocSpace: samples.reduce((sum, s) => sum + s.values.alloc_space, 0),
    files: [...new Set(frames.map(f => f.file!.replaceAll("\\", "/").split("/").pop()))],
    lines: [...new Set(frames.map(f => f.line))],
    startLines: [...new Set(frames.map(f => f.startLine))],
  }),
);
