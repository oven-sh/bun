// make-typed-family.mjs <folder>: TypeScript: what was tested or named in front of the loop over a generator is read in its turns, behind inner loops, on several yields.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const out = process.argv[2];
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const generators = {
  "a-yield-on-one-arm": `function* pick(flag: boolean): Generator<number> { if (flag) yield 1; yield 2; }`,
  "a-yield-on-each-arm": `function* pick(flag: boolean): Generator<number> { if (flag) yield 1; else yield 3; yield 2; }`,
  "three-in-a-row": `function* pick(flag: boolean): Generator<number> { yield 1; yield 2; if (flag) return; yield 3; }`,
  "a-loop-then-a-yield": `function* pick(flag: boolean): Generator<number> { for (let i = 0; i < 2; i++) yield i; if (flag) yield 9; }`,
  "a-yield-then-a-loop": `function* pick(flag: boolean): Generator<number> { if (flag) yield 9; for (let i = 0; i < 2; i++) yield i; }`,
  "two-loops": `function* pick(flag: boolean): Generator<number> { for (let i = 0; i < 2; i++) yield i; for (let j = 0; j < (flag ? 2 : 1); j++) yield 10 + j; }`,
  "a-yield-under-a-try": `function* pick(flag: boolean): Generator<number> { try { if (flag) yield 1; yield 2; } finally { tally++; } }`,
  "a-yield-in-a-catch": `function* pick(flag: boolean): Generator<number> { try { yield 1; if (flag) throw new Error("own"); yield 2; } catch { yield 7; } }`,
  "one-yield-in-a-loop": `function* pick(flag: boolean): Generator<number> { for (let i = 0; i < (flag ? 3 : 2); i++) yield i; }`,
  "over-another-generator": `function* inner(flag: boolean): Generator<number> { if (flag) yield 1; yield 2; }
function* pick(flag: boolean): Generator<number> { for (const value of inner(flag)) yield value * 2; if (flag) yield 5; }`,
};
const bodies = {
  "an-inner-loop-reads-a-field": `for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0; sum = (sum + x) | 0;`,
  "two-inner-loops-read-fields": `for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0; for (let j = 0; j < times; j++) sum = (sum + other.weight + item.weight) | 0; sum = (sum + x) | 0;`,
  "an-inner-loop-then-a-read-behind-it": `for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0; sum = (sum + x + item.weight) | 0;`,
  "an-inner-loop-under-a-test": `if (x > 1) { for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0; } sum = (sum + x + item.weight) | 0;`,
  "an-inner-loop-that-is-left": `for (let i = 0; i < times; i++) { sum = (sum + item.weight) | 0; if (sum > 40) break; } if (sum > 60) break; sum = (sum + x) | 0;`,
  "an-inner-loop-stores-a-field": `for (let i = 0; i < times; i++) { item.weight = (item.weight + 1) | 0; sum = (sum + item.weight) | 0; } item.weight = (item.weight - times) | 0; sum = (sum + x) | 0;`,
  "an-inner-loop-over-a-list": `for (const each of list) sum = (sum + each.weight + item.weight) | 0; sum = (sum + x) | 0;`,
  "an-inner-loop-calls-a-method": `for (let i = 0; i < times; i++) sum = (sum + item.twice()) | 0; sum = (sum + x) | 0;`,
  "a-name-is-narrowed-in-the-turn": `if (maybe !== null) { for (let i = 0; i < times; i++) sum = (sum + maybe.weight) | 0; } sum = (sum + x) | 0;`,
  "a-text-grows-in-an-inner-loop": `for (let i = 0; i < times; i++) text += item.weight; sum = (sum + x + text.length) | 0;`,
};
const behinds = { "nothing-behind": ``, "reads-behind-the-loop": `sum = (sum + item.weight + other.weight) | 0;`, "an-inner-loop-behind-the-loop": `for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0;` };
let count = 0;
for (const [generator, text] of Object.entries(generators))
  for (const [body, does] of Object.entries(bodies))
    for (const [behind, after] of Object.entries(behinds)) {
      const uses = name => (does + after).includes(name);
      writeFileSync(`${out}/${generator}--${body}--${behind}.ts`, `let tally = 0;
class Item {
  skip: boolean;
  weight: number;
  constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; }
  twice(): number { return this.weight * 2; }
}
${text}
function drive(list: Item[], at: number, times: number, flag: boolean): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const item = list[at];${uses("other") ? "\n  const other = list[(at + 1) % list.length];" : ""}${uses("maybe") ? "\n  const maybe: Item | null = at === 1 ? null : list[at];" : ""}
  if (item.skip) return -1;
  const first = item.weight;
  if (first > 90) return -2;
  let sum = work;${uses("text") ? '\n  let text = "";' : ""}
  for (const x of pick(flag)) {
    ${does}
  }
  ${after}
  return sum;
}
const stranger = JSON.parse('{"skip":false,"weight":3}'); stranger.twice = function () { return this.weight * 2; };
const items: Item[] = [new Item(false, 2), stranger, new Item(false, 5)];
let last = "";
for (let round = 0; round < 300; round++) {
  last = "";
  for (const flag of [false, true]) for (let at = 0; at < 3; at++) last += drive(items, at, 3, flag) + " ";
}
console.log(last + tally);
`);
      count++;
    }
const makers = {
  "yields-what-a-list-holds": `function* each(list: Item[], flag: boolean): Generator<Item> { if (flag) yield list[0]; yield list[1]; for (const one of list) yield one; }`,
  "yields-what-is-made-on-one-arm": `function* each(list: Item[], flag: boolean): Generator<Item> { const made = flag ? new Item(false, 7) : list[0]; yield made; yield new Item(false, 8); if (flag) yield made; }`,
  "yields-what-is-made-in-each-turn": `function* each(list: Item[], flag: boolean): Generator<Item> { for (let i = 0; i < list.length; i++) { const made = new Item(flag, list[i].weight + i); yield made; made.weight = -1; } }`,
  "yields-an-item-or-nothing": `function* each(list: Item[], flag: boolean): Generator<Item | null> { yield list[0]; if (flag) yield null; yield list[2]; }`,
  "yields-one-object-twice": `function* each(list: Item[], flag: boolean): Generator<Item> { const one = list[flag ? 0 : 2]; yield one; one.weight = (one.weight + 1) | 0; yield one; one.weight = (one.weight - 1) | 0; }`,
  "yields-records": `function* each(list: Item[], flag: boolean): Generator<{ weight: number; skip: boolean }> { if (flag) yield { weight: 4, skip: false }; for (const one of list) yield { weight: one.weight, skip: one.skip }; }`,
};
const takers = {
  "an-inner-loop-reads-its-field": `for (const one of each(list, flag)) { if (one === null) continue; for (let i = 0; i < times; i++) sum = (sum + one.weight) | 0; }`,
  "closures-capture-the-variable-of-the-head": `const reads: (() => number)[] = []; for (const one of each(list, flag)) { if (one === null) continue; reads.push(() => one.weight); } for (const read of reads) sum = (sum + read()) | 0;`,
  "a-closure-on-the-way-out-captures-it": `let read: (() => number) | null = null; for (const one of each(list, flag)) { if (one !== null && one.weight > 2) { read = () => one.weight * 2; break; } } sum = (sum + (read === null ? -5 : read())) | 0;`,
  "the-last-is-kept": `let last: { weight: number } | null = null; for (const one of each(list, flag)) { if (one === null) continue; last = one; if (one.weight > 6) break; } sum = (sum + (last === null ? 0 : last.weight)) | 0;`,
  "an-inner-loop-stores-its-field": `for (const one of each(list, flag)) { if (one === null) continue; const before = one.weight; for (let i = 0; i < times; i++) one.weight = (one.weight + i) | 0; sum = (sum + one.weight) | 0; one.weight = before; }`,
  "it-is-held-against-what-was-tested-in-front": `for (const one of each(list, flag)) { for (let i = 0; i < times; i++) sum = (sum + (one === item ? item.weight : 1)) | 0; }`,
  "all-are-kept-in-a-list": `const kept: number[] = []; for (const one of each(list, flag)) { if (one === null) { kept.push(-1); continue; } kept.push(one.weight); } for (let i = 0; i < kept.length; i++) sum = (sum + kept[i] * (i + 1)) | 0;`,
  "spread-into-a-list": `const all = [...each(list, flag)]; for (let i = 0; i < all.length; i++) { const one = all[i]; sum = (sum + (one === null ? -1 : one.weight)) | 0; }`,
};
for (const [maker, text] of Object.entries(makers))
  for (const [taker, does] of Object.entries(takers))
    for (const calls of ["called-often", "called-once"]) {
      writeFileSync(`${out}/${maker}--${taker}--${calls}.ts`, `class Item {
  skip: boolean;
  weight: number;
  constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; }
}
${text}
function drive(list: Item[], at: number, times: number, flag: boolean): number {
  const item = list[at];
  if (item.skip) return -1;
  let sum = item.weight;
  ${does}
  return sum;
}
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];
${calls === "called-once" ? `console.log(drive(items, process.argv.length > 99 ? 1 : 2, 3, process.argv.length < 99));` : `let last = "";
for (let round = 0; round < 300; round++) {
  last = "";
  for (const flag of [false, true]) for (let at = 0; at < 3; at++) last += drive(items, at, 3, flag) + " ";
}
console.log(last);`}
`);
      count++;
    }
const throwers = {
  "throws-behind-a-yield-on-one-arm": `function* pick(flag: boolean, n: number): Generator<number> { if (flag) yield 1; check(n); yield 2; }`,
  "throws-in-a-loop-behind-its-yield": `function* pick(flag: boolean, n: number): Generator<number> { for (let i = 0; i < 2; i++) { yield i; check(n + (flag ? i * 30 : 0)); } }`,
  "throws-on-an-arm-and-at-the-end": `function* pick(flag: boolean, n: number): Generator<number> { yield 1; if (flag) { check(n); yield 2; } check(n - 30); }`,
  "throws-under-its-own-finally": `function* pick(flag: boolean, n: number): Generator<number> { try { if (flag) yield 1; check(n); yield 2; } finally { tally++; } }`,
  "throws-and-catches-then-yields": `function* pick(flag: boolean, n: number): Generator<number> { if (flag) yield 1; try { check(n); } catch { yield 8; check(n - 30); } yield 2; }`,
  "throws-in-front-of-every-yield": `function* pick(flag: boolean, n: number): Generator<number> { check(n + 40); if (flag) yield 1; yield 2; }`,
};
const catchers = {
  "a-catch-reads-it": `try { for (const x of pick(flag, n)) { for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0; sum = (sum + x) | 0; } } catch { sum = (sum + item.weight * 100) | 0; }`,
  "a-finally-reads-it": `try { try { for (const x of pick(flag, n)) { for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0; sum = (sum + x) | 0; } } finally { sum = (sum + item.weight * 10) | 0; } } catch { sum = -sum; }`,
  "a-catch-loops-over-it": `try { for (const x of pick(flag, n)) { for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0; if (x === 2) break; } } catch { for (let i = 0; i < times; i++) sum = (sum + item.weight * 7) | 0; }`,
  "a-catch-in-an-outer-loop-reads-it": `for (let round = 0; round < 2; round++) { try { for (const x of pick(flag, n + round * 20)) { for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0; sum = (sum + x) | 0; } } catch { sum = (sum + item.weight * 100) | 0; continue; } sum = (sum + item.weight) | 0; }`,
  "the-turn-catches-its-own-and-a-catch-around-reads-it": `try { for (const x of pick(flag, n)) { try { for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0; check(n + x * 10); } catch { sum = (sum + item.weight * 3) | 0; } } } catch { sum = (sum + item.weight * 100) | 0; }`,
};
for (const [thrower, text] of Object.entries(throwers))
  for (const [catcher, does] of Object.entries(catchers))
    for (const [behind, after] of Object.entries({ "nothing-behind": ``, "reads-behind": `sum = (sum + item.weight) | 0;`, "an-inner-loop-behind": `for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0;` })) {
      writeFileSync(`${out}/${thrower}--${catcher}--${behind}.ts`, `let tally = 0;
class Item {
  skip: boolean;
  weight: number;
  constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; }
}
const most = Number(process.argv.length < 99 ? 100 : 0);
function check(n: number): void { if (n > most) throw new RangeError("over"); }
${text}
function drive(list: Item[], at: number, times: number, flag: boolean, n: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const item = list[at];
  if (item.skip) return -1;
  const first = item.weight;
  if (first > 90) return -2;
  let sum = work;
  ${does}
  ${after}
  return sum;
}
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];
let last = "";
for (let round = 0; round < 300; round++) {
  last = "";
  for (const flag of [false, true]) for (let at = 0; at < 3; at++) for (const n of [50, 75, 95, 125]) last += drive(items, at, 3, flag, n) + " ";
}
console.log(last + tally);
`);
      count++;
    }
console.log(count + " programs");
