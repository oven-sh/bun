import { Cursor, lineOf, table, uses } from "./typed.ts";

export const ways = {
  "out of a table": n => table.uses(n),
  "by call": n => uses.call(null, n),
  "by apply": n => uses.apply(null, [n]),
  "bound": n => uses.bind(null, n)(),
  "as a callback": n => [n].map(uses)[0],
  "under another name": n => {
    const run = uses;
    return run(n);
  },
  "out of a list": n => [uses][0](n),
  "by Reflect.apply": n => Reflect.apply(uses, undefined, [n]),
  "stored in a field": n => {
    const cursor = new Cursor(1);
    cursor.line = n;
    return [lineOf(cursor), cursor.lineOf(), cursor.sum(), cursor.plainSum(), JSON.stringify(cursor)];
  },
  "stored in a field by a computed name": n => {
    const cursor = new Cursor(1);
    cursor[["li", "ne"].join("")] = n;
    return [lineOf(cursor), cursor.lineOf(), cursor.sum(), cursor.plainSum()];
  },
  "constructed by Reflect.construct": n => {
    const cursor = Reflect.construct(Cursor, [n]);
    return [lineOf(cursor), cursor.sum(), cursor.plainSum()];
  },
  "a look-alike is handed over": n => lineOf({ line: n, column: 0 }),
};

export function withNothing() {
  const run = uses;
  return run();
}
