// memory-left-behind.ts <n>: four record types, n objects of each parsed with their ten names in n orders, everything dropped. Prints the anonymous memory that is left, in MB.
import { readFileSync } from "node:fs";
type R0 = { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number; i: number; j: number };
type R1 = { a1: number; b1: number; c1: number; d1: number; e1: number; f1: number; g1: number; h1: number; i1: number; j1: number };
type R2 = { a2: number; b2: number; c2: number; d2: number; e2: number; f2: number; g2: number; h2: number; i2: number; j2: number };
type R3 = { a3: number; b3: number; c3: number; d3: number; e3: number; f3: number; g3: number; h3: number; i3: number; j3: number };
const letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
function order(number: number, suffix: string): string[] {
  const left = letters.map(letter => letter + suffix);
  const out: string[] = [];
  for (let size = left.length; size > 0; size--) {
    out.push(left.splice(number % size, 1)[0]);
    number = Math.floor(number / size);
  }
  return out;
}
const textOf = (names: string[]) => "{" + names.map((name, at) => '"' + name + '":' + at).join(",") + "}";
const listText = (n: number, suffix: string) => "[" + Array.from({ length: n }, (_, at) => textOf(order(at, suffix))).join(",") + "]";
const sum0 = (rows: R0[]) => rows.reduce((sum, row) => sum + row.a + row.j + Object.keys(row).length, 0);
const sum1 = (rows: R1[]) => rows.reduce((sum, row) => sum + row.a1 + row.j1 + Object.keys(row).length, 0);
const sum2 = (rows: R2[]) => rows.reduce((sum, row) => sum + row.a2 + row.j2 + Object.keys(row).length, 0);
const sum3 = (rows: R3[]) => rows.reduce((sum, row) => sum + row.a3 + row.j3 + Object.keys(row).length, 0);
const n = Number(process.argv[2]);
let answer = 0;
answer += sum0(JSON.parse(listText(n, "")));
answer += sum1(JSON.parse(listText(n, "1")));
answer += sum2(JSON.parse(listText(n, "2")));
answer += sum3(JSON.parse(listText(n, "3")));
for (let turn = 0; turn < 4; turn++) {
  Bun.gc(true);
  await Bun.sleep(150);
}
console.log(Math.round(Number(/RssAnon:\s+(\d+)/.exec(readFileSync("/proc/self/status", "utf8"))![1]) / 1024), answer);
