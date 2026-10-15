// The host of ./main.ts in a program that is also given data from outside under the names of the reconciler's own records. None of it may open the records that an update walks to outside objects.
import "./main.ts";

declare const console: { log(...all: unknown[]): void };

type Everyday = {
  a: { current: unknown };
  b: { mode: unknown; children: unknown };
  c: { pending: unknown };
  d: { destroy: unknown };
  e: { lanes: unknown; firstContext: unknown };
  f: { memoizedState: unknown; next: unknown };
  g: { tag: unknown; flags: unknown; return: unknown; alternate: unknown };
  h: { then: unknown };
  i: { value: unknown; getSnapshot: unknown };
};
const everyday = JSON.parse(
  `{"a":{"current":1},"b":{"mode":2,"children":[]},"c":{"pending":null},"d":{"destroy":3},"e":{"lanes":4,"firstContext":null},"f":{"memoizedState":5,"next":null},"g":{"tag":6,"flags":7,"return":null,"alternate":null},"h":{"then":8},"i":{"value":9,"getSnapshot":10}}`,
) as Everyday;
console.log(`everyday ${everyday.a.current} ${everyday.b.mode} ${everyday.c.pending} ${everyday.d.destroy} ${everyday.e.lanes} ${everyday.f.memoizedState} ${everyday.g.tag} ${everyday.g.flags} ${everyday.h.then} ${everyday.i.value}`);
