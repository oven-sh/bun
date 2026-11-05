// Appending a piece to a string costs the same however long the string already is.
//
// Each idiom appends 200,000 pieces twice: 500 to each of 400 strings, then 8,000 to each of 25 strings. The work is the same, so the
// CPU time is about the same. A loop that copies the string at every append takes sixteen times as long for the long strings.
// The program measures itself with process.cpuUsage(), around the loop alone, so the test needs no counters and runs on every platform.
//
//   AOT_STRING_APPENDS=<text>    only the idioms whose name contains the text
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { describe, test } from "./supported";

// `build(appends)` answers the length of the string it has built.
const idioms: Record<string, string> = {
  "plain loop": `
    function build(appends: number) { let text = ""; for (let i = 0; i < appends; i++) text += piece(i); return text.length; }`,
  "try and catch": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) { try { text += "n" + i + ";"; } catch { text += "T"; } }
      return text.length;
    }`,
  "try and catch, a constant piece": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) { try { text += "piece;"; } catch { text += "T"; } }
      return text.length;
    }`,
  "try and catch, a call makes the piece": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) { try { text += piece(i); } catch { text += "T"; } }
      return text.length;
    }`,
  "try and catch, a call after the append": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) { try { text += "n" + i + ";"; check(i); } catch { text += "T"; } }
      return text.length;
    }`,
  "try and finally": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) { try { text += piece(i); } finally { text += "F"; } }
      return text.length;
    }`,
  "try, catch and finally": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) { try { text += piece(i); } catch { text += "T"; } finally { text += "F"; } }
      return text.length;
    }`,
  "nested tries": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) {
        try { try { text += piece(i); check(i); } catch { text += "I"; check(i); } } catch { text += "O"; }
      }
      return text.length;
    }`,
  "a loop inside the try": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i += 10) {
        try { for (let j = 0; j < 10; j++) { text += piece(j); check(i + j); } } catch { text += "T"; }
      }
      return text.length;
    }`,
  "the catch appends the error": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) { try { text += piece(i); check(i); } catch (e) { text += "error: " + (e as Error).message; } }
      return text.length;
    }`,
  "the catch reads the string": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) { try { text += piece(i); check(i); } catch { text = text + "T" + text.length; } }
      return text.length;
    }`,
  "template literals": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) { try { text = \`\${text}n\${i};\`; } catch { text = \`\${text}T\`; } }
      return text.length;
    }`,
  "concat()": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) { try { text = text.concat("n", String(i), ";"); } catch { text = text.concat("T"); } }
      return text.length;
    }`,
  "a field of a local object": `
    function build(appends: number) {
      const holder = { text: "" };
      for (let i = 0; i < appends; i++) { try { holder.text += piece(i); } catch { holder.text += "T"; } }
      return holder.text.length;
    }`,
  "a field of this": `
    class Writer { text = ""; add(i: number) { try { this.text += piece(i); } catch { this.text += "T"; } } }
    function build(appends: number) { const writer = new Writer(); for (let i = 0; i < appends; i++) writer.add(i); return writer.text.length; }`,
  "a variable of the module": `
    let text = "";
    function add(i: number) { try { text += piece(i); check(i); } catch { text += "T"; } }
    function build(appends: number) { text = ""; for (let i = 0; i < appends; i++) add(i); return text.length; }`,
  "a closure appends": `
    function build(appends: number) {
      let text = "";
      const add = (piece: string) => { text += piece; };
      for (let i = 0; i < appends; i++) { try { add(piece(i)); } catch { add("T"); } }
      return text.length;
    }`,
  "a generator walked by next()": `
    function* steps(appends: number): Generator<number, number, void> {
      let text = "";
      for (let i = 0; i < appends; i++) { try { text += piece(i); if (i % 100 === 0) yield i; } catch { text += "T"; } }
      return text.length;
    }
    function build(appends: number) { const walk = steps(appends); for (;;) { const step = walk.next(); if (step.done) return step.value; } }`,
  "an async function": `
    async function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) { try { text += piece(i); if (i % 100 === 0) await null; } catch { text += "T"; } }
      return text.length;
    }`,
  "the value before the appends is restored": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) {
        const before = text;
        text += "a"; text += i; text += "b"; text += i; text += "c";
        if (i % 7 === 0) text = before;
      }
      return text.length;
    }`,
  "one of two longer strings is taken": `
    function build(appends: number) {
      let text = "";
      for (let i = 0; i < appends; i++) { const longer = text + "n" + i + ";"; text = i % 3 === 0 ? text + "T" : longer; }
      return text.length;
    }`,
  "each string begins with a long one": `
    function build(appends: number) {
      const long = "x".repeat(appends * 7);
      const kept: string[] = ["", ""];
      for (let i = 0; i < appends; i++) { let text = long; text += "a"; text += i; text += "b"; text += piece(i); kept[i & 1] = text; }
      return appends + kept[0].length + kept[1].length;
    }`,
  "the string starts over from a long one": `
    function build(appends: number) {
      const long = "x".repeat(appends * 7);
      let text = "", lengths = 0;
      for (let i = 0; i < appends; i++) { if (i % 2 === 0) { lengths += text.length; text = long; } else text += piece(i); }
      return lengths + text.length;
    }`,
  "two strings change places": `
    function build(appends: number) {
      let first = "", second = "";
      for (let i = 0; i < appends; i++) { first += piece(i); const held = first; first = second; second = held; }
      return first.length + second.length;
    }`,
};

const names = Object.keys(idioms).filter(name => name.includes(process.env.AOT_STRING_APPENDS ?? ""));

const files = Object.fromEntries(
  names.map((name, index) => [
    `idiom-${index}.ts`,
    `import { check, piece } from "./pieces";
    ${idioms[name]}
    export default build;`,
  ]),
);
files["pieces.ts"] = `
  export function piece(i: number): string { if (i === -1) throw new Error("no piece"); return "n" + i + ";"; }
  export function check(i: number): void { if (i % 1000 === 999) throw new Error("no"); }`;
files["main.ts"] = `
  ${names.map((_, index) => `import idiom${index} from "./idiom-${index}";`).join("\n")}
  const idioms: ((appends: number) => number | Promise<number>)[] = [${names.map((_, index) => `idiom${index}`).join(", ")}];
  const build = idioms[Number(process.argv[2])];
  const appends = Number(process.argv[3]), strings = Number(process.argv[4]);
  let length = 0;
  const start = process.cpuUsage();
  for (let i = 0; i < strings; i++) length += await build(appends);
  const spent = process.cpuUsage(start);
  console.log(JSON.stringify({ length, milliseconds: (spent.user + spent.system) / 1000 }));`;

const dir = tempDir("aot-string-appends", files);
afterAll(() => dir[Symbol.dispose]());
const folder = String(dir);
const path = join(folder, isWindows ? "main.exe" : "main");
let whenBuilt: Promise<void> | undefined;
const build = () =>
  (whenBuilt ??= spawned(
    [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", path],
    folder,
    bunEnv,
  ).then(built));

describe.concurrent("appending to a long string costs what appending to a short one costs", () => {
  for (const [index, name] of names.entries()) {
    test(
      name,
      async () => {
        await build();
        const measure = async (appends: number, strings: number) => {
          let least = Infinity;
          for (let run = 0; run < 2; run++) {
            const ran = await spawned([path, String(index), String(appends), String(strings)], folder, bunEnv, 200_000);
            expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
            const { length, milliseconds } = JSON.parse(ran.stdout);
            expect(length).toBeGreaterThan(appends * strings);
            least = Math.min(least, milliseconds);
          }
          return least;
        };
        const short = await measure(500, 400);
        const long = await measure(8000, 25);
        console.error(
          `APPENDS ${name}: ${short.toFixed(1)} ms for short strings | ${long.toFixed(1)} ms for long ones`,
        );
        expect(long).toBeLessThan(3 * short + 60);
      },
      480_000,
    );
  }
});
