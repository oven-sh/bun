// ./main.ts in a program that is also given data from outside under the names of the renderer's own records. None of it may open the records that an update walks to outside objects.
import "./main.ts";

declare const console: { log(...all: unknown[]): void };

type Everyday = {
  a: { state: unknown; queue: unknown; next: unknown };
  b: { last: unknown; dispatch: unknown };
  c: { lane: unknown; action: unknown; next: unknown };
  d: { flags: unknown; run: unknown; cleanup: unknown; inputs: unknown; next: unknown };
  e: { context: unknown; next: unknown };
  f: { type: unknown; key: unknown; props: unknown };
  g: { kind: unknown; flags: unknown; lanes: unknown; parent: unknown; twin: unknown };
  h: { container: unknown; shown: unknown; children: unknown; pending: unknown };
  i: { is: unknown; value: unknown };
};
const everyday = JSON.parse(
  `{"a":{"state":1,"queue":null,"next":null},"b":{"last":null,"dispatch":2},"c":{"lane":3,"action":4,"next":null},"d":{"flags":5,"run":6,"cleanup":null,"inputs":[],"next":null},"e":{"context":7,"next":null},"f":{"type":"box","key":null,"props":{}},"g":{"kind":8,"flags":9,"lanes":10,"parent":null,"twin":null},"h":{"container":11,"shown":null,"children":[],"pending":12},"i":{"is":"context","value":13}}`,
) as Everyday;
console.log(
  `everyday ${everyday.a.state} ${everyday.b.dispatch} ${everyday.c.lane} ${everyday.c.action} ${everyday.d.flags} ${everyday.d.run} ${everyday.e.context} ${everyday.f.type} ${everyday.g.kind} ${everyday.g.flags} ${everyday.g.lanes} ${everyday.h.container} ${everyday.h.pending} ${everyday.i.value}`,
);
