import {
  checkBetween,
  literalBetween,
  makeLoose,
  narrowBetween,
  nothingBetween,
  readsAll,
  readsOn,
  tagBetween,
  untypedCallBetween,
  untypedLiteralBetween,
  untypedWrapBetween,
  writesAll,
  writesOn,
} from "untyped";
import { firstOf, keeps, makeTyped, sumOf, wraps } from "./typed.ts";

const run: Record<string, (...all: any[]) => any> = {
  nothingBetween,
  untypedCallBetween,
  checkBetween,
  tagBetween,
  narrowBetween,
  untypedWrapBetween,
  literalBetween,
  untypedLiteralBetween,
  readsAll,
  writesAll,
  readsOn,
  writesOn,
  sumOf,
  firstOf,
  keeps,
};
const show = (value: unknown): string => JSON.stringify(value);
const outcome = (f: () => unknown): string => {
  try {
    return show(f());
  } catch (e) {
    return (e as Error).constructor.name;
  }
};
const typed = makeTyped(10, 20, 30);

const scenarios: [string, (round: number) => string[]][] = [
  [
    "nothing converts",
    round => [
      ...["nothingBetween", "untypedCallBetween", "checkBetween", "tagBetween", "narrowBetween", "untypedWrapBetween"].map(name => show(run[name](makeLoose(round, 1, 2), typed))),
      ...["literalBetween", "untypedLiteralBetween"].map(name => show(run[name](makeLoose(round, 1, 2), round))),
      show(run.readsOn(makeLoose(1, 2, 3), () => 0)),
    ],
  ],
  [
    "reads and stores meet typed objects",
    round => {
      const line = [show(run.readsAll(makeLoose(1, 2, 3))), show(run.readsAll(typed)), show(run.readsAll(makeTyped(round, 0.5, -1)))];
      for (const target of [makeLoose(0, 0, 0), makeTyped(0, 0, 0)]) {
        run.writesAll(target, round, round + 1, round + 2);
        line.push(show(target), String(target.first + target.second + target.third));
        run.writesAll(target, 0.5, 1.5, 2.5);
        line.push(show(target));
      }
      const written = makeTyped(0, 0, 0);
      run.writesAll(written, 1, 2, 3);
      line.push(String(run.sumOf(written)));
      return line;
    },
  ],
  [
    "an inlined check of a declared type converts the guarded object",
    round => {
      const itself = makeLoose(round + 2, round + 3, round + 4);
      return [show(run.checkBetween(itself, itself)), show(itself), String(run.sumOf(itself))];
    },
  ],
  [
    "an inlined typed read converts the guarded object",
    round => {
      const itself = makeLoose(round + 1, round + 2, round + 3);
      return [show(run.tagBetween(itself, itself)), show(itself), String(run.sumOf(itself))];
    },
  ],
  [
    "a typed literal that is never allocated converts the guarded object",
    round => {
      const itself = makeLoose(round + 4, round + 5, round + 6);
      return [show(run.narrowBetween(itself, itself)), show(itself), String(run.sumOf(itself))];
    },
  ],
  [
    "a callee's typed read converts, the caller reads on",
    round => {
      const itself = makeLoose(round + 1, round + 2, round + 3);
      return [show(run.readsOn(itself, run.firstOf)), show(itself)];
    },
  ],
  [
    "a callee's typed read converts, the caller writes on",
    round => {
      const itself = makeLoose(0, 0, 0);
      run.writesOn(itself, run.sumOf, round);
      return [show(itself), String(run.sumOf(itself))];
    },
  ],
  [
    "a callee's typed store converts the value, the caller reads on",
    round => {
      const holder = wraps(typed);
      const itself = makeLoose(round + 7, round + 8, round + 9);
      return [show(run.readsOn(itself, (o: any) => run.keeps(holder, o))), show(itself), String(run.sumOf(holder.inner))];
    },
  ],
  [
    "a callee's typed store converts the value, the caller writes on",
    round => {
      const holder = wraps(typed);
      const itself = makeLoose(0, 0, 0);
      run.writesOn(itself, (o: any) => run.keeps(holder, o), round);
      return [show(itself), String(run.sumOf(holder.inner))];
    },
  ],
];
const first = Number(process.argv[2] ?? 0) % scenarios.length;
for (let round = 0; round < 3; ++round) {
  for (let i = 0; i < scenarios.length; ++i) {
    const [what, scenario] = scenarios[(first + i) % scenarios.length];
    console.log(round + " " + what + ": " + scenario(round).join(" "));
  }
}
const strict: string[] = [];
for (const wrong of ["text", null, undefined, true, { valueOf: () => 40 }]) {
  const target = makeTyped(1, 2, 3);
  strict.push(outcome(() => run.writesAll(target, 7, wrong, 9)), show(target), String(run.sumOf(target)));
}
console.log("STRICT " + strict.join(" "));
(globalThis as any).Bun?.gc(true);
