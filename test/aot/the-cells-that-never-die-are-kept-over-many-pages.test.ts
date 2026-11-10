// A literal text is made at its first use and never dies: the run time lists it among the roots. The list is made of pages; this program fills three of them between young and full collections
// and reads every text again behind them.
import { buildBothWays } from "./build-both-ways";

const functions = Array.from(
  { length: 13 },
  (_, f) =>
    `function f${f}() {\n${Array.from({ length: 100 }, (_, i) => `  sum += use("literal number ${i} of function ${f}");`).join("\n")}\n}`,
).join("\n");
const calls = Array.from({ length: 13 }, (_, f) => `  f${f}(); churn();${f % 4 === 0 ? " Bun.gc(true);" : ""}`).join(
  "\n",
);

buildBothWays("compile/aot/the cells that never die are kept over many pages", {
  "thirteen hundred literal texts are read again behind collections": {
    alone: true,
    files: {
      "main.ts": `let sum = 0;
const junk: unknown[] = [];
function churn() { for (let i = 0; i < 2000; i++) junk[i % 64] = { a: i, b: [i, String(i)] }; }
function use(text: string): number { let n = 0; for (let i = 0; i < text.length; i += 7) n += text.charCodeAt(i); return n; }
${functions}
for (let round = 0; round < 3; round++) {
${calls}
}
console.log(sum);
`,
    },
    prints: "1473030\n",
  },
});
