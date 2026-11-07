// Loops in C++ over iterators of JS, and loops in C++ that call a function of JS's for every item. No code of Python's is called for an item, and each loop ends only when something of
// Python's has had its turn in the middle of it: it goes on until a file is there. (A loop that never ends is killed by whoever runs this.)
import { existsSync, writeSync } from "node:fs";
import { join } from "node:path";
const [directory, what] = process.argv.slice(2);
const builtins = require("python:builtins");
const helpers = await import("./turns-in-loops-of-c.py");

type Source = (isOver: () => boolean, item: unknown) => unknown;
const sources: Record<string, Source> = {
  "a generator": (isOver, item) =>
    (function* () {
      while (!isOver()) yield item;
    })(),
  "an iterable": (isOver, item) => ({
    [Symbol.iterator]: () => ({ next: () => (isOver() ? { done: true } : { done: false, value: item }) }),
  }),
};
const loops: Record<string, [unknown, (source: unknown) => unknown]> = {
  "sum()": [0, s => builtins.sum(s)],
  "list()": [0, s => builtins.len(builtins.list(s)) > 0],
  "tuple()": [0, s => builtins.len(builtins.tuple(s)) > 0],
  "min()": [0, s => builtins.min(s)],
  "any()": [0, s => builtins.any(s)],
  "all()": [1, s => builtins.all(s)],
  "in": [0, s => helpers.contains(s, 1)],
  "set()": [0, s => helpers.consume_set(s)],
  "str.join()": ["", s => helpers.consume_join(s)],
  "dict.fromkeys()": [0, s => helpers.consume_dict(s)],
  "sorted()": [0, s => builtins.len(builtins.sorted(s)) > 0],
};
const callers = [
  "any_map",
  "next_filter",
  "next_filterfalse",
  "next_dropwhile",
  "all_takewhile",
  "any_starmap",
  "any_accumulate",
  "all_iter",
];
// What is done before the loop, and at an item in the middle of it.
const whats: Record<string, (path: string) => [() => void, (item: number) => void]> = {
  "a thread": path => {
    let writable: number;
    return [() => void (writable = Number(helpers.start_thread(path))), item => item === 5 && writeSync(writable, ".")];
  },
  "a handler": path => [() => helpers.handle(path), item => item === 5 && process.kill(process.pid, "SIGUSR1")],
  "a finalizer": path => [() => helpers.drop(path), item => item % 100 === 5 && Bun.gc(true)],
  "a handler that raises": () => [
    () => helpers.handle_by_raising(),
    item => item === 5 && process.kill(process.pid, "SIGUSR1"),
  ],
};
let serial = 0;
function turn(name: string, run: (isOver: () => boolean) => unknown) {
  const path = join(directory, String(++serial));
  const [before, atItem] = whats[what](path);
  before();
  let item = 0;
  let result;
  try {
    result = String(run(() => (atItem(item++), existsSync(path))));
  } catch (error) {
    result = String(error).split("\n")[0];
  }
  console.log(`${name}: ${result}`);
}
for (const [loop, [item, run]] of Object.entries(loops))
  for (const [source, make] of Object.entries(sources))
    turn(`${loop} over ${source}`, isOver => run(make(isOver, item)));
for (const name of callers) turn(name, isOver => helpers[name](isOver, () => !isOver()));
for (const name of ["construct", "construct_by_new", "construct_subclass"])
  turn(name, isOver =>
    helpers[name](
      class {
        constructor() {
          if (isOver()) throw new Error("over");
        }
      },
    ),
  );
turn("send", isOver => helpers.send(sources["a generator"](isOver, 0)));
process.exit(0);
