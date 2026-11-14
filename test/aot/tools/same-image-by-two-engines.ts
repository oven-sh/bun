// Compiles the same programs by two builds of the engine and holds the images against each other, byte for byte.
// A compiler built with a sanitizer or with assertions emits what the release compiler emits: else its lane proves another product than the one that ships.
//
//   bun test/aot/tools/same-image-by-two-engines.ts <testaot> <testaot> <file.ir | folder> ..
//   --jobs=<n>                  how many programs are compiled at once. Default: 8
//   --second-takes="<words>"    the second engine takes these option words too: the red control: with check=Validate the images must differ
//   --prints=<command>          holds what `testaot <command> <file>` prints against each other instead of the images, and shows the first line that differs.
//                               Where the images differ, ask stage by stage where the two engines part: link, plan, walk, emit, allocate, frame, bytes
//
// Both engines are built of ONE text: another minute's engine reads another schema and says nothing about bytes.
// The stamp in the head of an image (bytes 8 to 15) is a digest of what the runtime is like: sizes, offsets, tables. It is left out of the comparison and told by itself:
// where it differs and nothing else does, the two runtimes differ in a fact that no byte of these programs hangs on.
// A program that one engine compiles and the other refuses counts as a difference. One that both refuse counts as nothing and is told at the end.
// Of two images that differ the line says in how many bytes, part by part: the head, the functions with the copies of the stubs that lie among them, the code behind them, and the rest (tables, texts).
// The parts are read out of the first image's head (image/AOTImageFormat.h ImageHeader: codeOffset at 40, codeSize at 48, code.functionsEnd at 336).
// A small program's code is nearly all stubs, and stubs of another length move every function behind them: so the count says little about the functions. --prints=bytes holds them unit by unit.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const flags = process.argv.slice(2).filter(word => word.startsWith("--"));
const [first, second, ...roots] = process.argv.slice(2).filter(word => !word.startsWith("--"));
if (!first || !second || !roots.length) throw new Error("usage: same-image-by-two-engines.ts <testaot> <testaot> <file.ir | folder> ..");
const valueOf = (name: string) => flags.find(flag => flag.startsWith(`--${name}=`))?.slice(name.length + 3);
const jobs = Number(valueOf("jobs") ?? 8);
const wordsOfSecond = (valueOf("second-takes") ?? "").split(" ").filter(Boolean);
const printed = valueOf("prints");

const filesUnder = (path: string): string[] =>
  statSync(path).isDirectory() ? readdirSync(path).sort().flatMap(name => filesUnder(join(path, name))) : path.endsWith(".ir") ? [path] : [];
const files = roots.flatMap(filesUnder);

const folder = mkdtempSync(join(tmpdir(), "same-image-"));
async function compile(engine: string, file: string, image: string, words: string[]) {
  if (printed) {
    const child = Bun.spawn([engine, printed, file, ...words], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const said = Buffer.from(await new Response(child.stdout).arrayBuffer());
    return (await child.exited) === 0 ? said : null;
  }
  const child = Bun.spawn([engine, "compile", file, `--output=${image}`, "threads=1", ...words], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  return (await child.exited) === 0 ? readFileSync(image) : null;
}

const withoutStamp = (image: Buffer) => Buffer.concat([image.subarray(0, 8), image.subarray(16)]);
let same = 0;
let stampsDiffer = 0;
let refusedByBoth = 0;
const differing: string[] = [];
const programsByPart = { head: 0, functionsAndStubs: 0, codeBehind: 0, rest: 0 };
let next = 0;
await Promise.all(
  Array.from({ length: jobs }, async (_, worker) => {
    while (next < files.length) {
      const file = files[next++]!;
      const [one, other] = await Promise.all([
        compile(first, file, join(folder, `${worker}.first`), []),
        compile(second, file, join(folder, `${worker}.second`), wordsOfSecond),
      ]);
      if (!one && !other) refusedByBoth++;
      else if (!one || !other) differing.push(`${file}: the ${one ? "second" : "first"} engine does not compile it`);
      else if (printed) {
        if (one.equals(other)) same++;
        else {
          const [lines, otherLines] = [one.toString().split("\n"), other.toString().split("\n")];
          let at = 0;
          while (at < lines.length && at < otherLines.length && lines[at] === otherLines[at]) at++;
          differing.push(`${file}: ${lines.length} | ${otherLines.length} lines, the first that differs is ${at + 1}:\n    ${(lines[at] ?? "").slice(0, 300)}\n    ${(otherLines[at] ?? "").slice(0, 300)}`);
        }
      } else if (withoutStamp(one).equals(withoutStamp(other))) {
        same++;
        if (!one.equals(other)) stampsDiffer++;
      } else {
        const codeOffset = Number(one.readBigUInt64LE(40));
        const endOfFunctions = codeOffset + one.readUInt32LE(336);
        const endOfCode = codeOffset + Number(one.readBigUInt64LE(48));
        const bytes = { head: 0, functionsAndStubs: 0, codeBehind: 0, rest: 0 };
        let first = -1;
        for (let at = 16; at < Math.min(one.length, other.length); at++) {
          if (one[at] === other[at]) continue;
          if (first < 0) first = at;
          bytes[at < 544 ? "head" : at >= codeOffset && at < endOfFunctions ? "functionsAndStubs" : at >= endOfFunctions && at < endOfCode ? "codeBehind" : "rest"]++;
        }
        for (const part of ["head", "functionsAndStubs", "codeBehind", "rest"] as const) if (bytes[part]) programsByPart[part]++;
        differing.push(`${file}: ${one.length} | ${other.length} bytes, the first difference at ${first}; bytes that differ: head ${bytes.head}, functions and stubs ${bytes.functionsAndStubs} of ${endOfFunctions - codeOffset}, code behind them ${bytes.codeBehind} of ${endOfCode - endOfFunctions}, rest ${bytes.rest}`);
      }
    }
  }),
);
rmSync(folder, { recursive: true, force: true });
for (const line of differing) console.log(line);
console.log(`${files.length} programs: ${same} ${printed ? `prints of ${printed}` : "images"} the same (${stampsDiffer} of them but for the stamp), ${differing.length} differ, ${refusedByBoth} refused by both`);
if (differing.length && !printed) console.log(`programs that differ in the head ${programsByPart.head}, in functions and stubs ${programsByPart.functionsAndStubs}, in the code behind them ${programsByPart.codeBehind}, in the rest ${programsByPart.rest}`);
process.exit(differing.length ? 1 : 0);
