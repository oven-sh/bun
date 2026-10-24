// Eight optional fields, two past the inline capacity, created in 24 orders through one store site each: the key order advances without the run time, and locked objects, extra properties and repeated stores keep their keys.
"use strict";
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const creationRows = () => counted ? counted("operationAOTDidCreateFieldAt") + counted("operationAOTDidCreateFieldOutOfLineAt") + counted("operationAOTDidCreateFieldsAt") : 0;

interface Tag { tag: number }
interface Sparse { a?: string; b?: string; c?: Tag; d?: Tag; e?: string; f?: Tag; g?: any; h?: any }
interface Field { name: string; store: (target: Sparse, k: number) => void; text: (k: number) => string }

const shared: Tag = { tag: 1 };
const mixed = (k: number): any => (k & 1 ? k : "m" + k);
const fields: Field[] = [
  { name: "a", store: (target, k) => { target.a = "a" + k; }, text: k => `"a":"a${k}"` },
  { name: "b", store: (target, k) => { target.b = "b" + k; }, text: k => `"b":"b${k}"` },
  { name: "c", store: target => { target.c = shared; }, text: () => `"c":{"tag":1}` },
  { name: "d", store: target => { target.d = shared; }, text: () => `"d":{"tag":1}` },
  { name: "e", store: (target, k) => { target.e = "e" + k; }, text: k => `"e":"e${k}"` },
  { name: "f", store: target => { target.f = shared; }, text: () => `"f":{"tag":1}` },
  { name: "g", store: (target, k) => { target.g = mixed(k); }, text: k => `"g":${JSON.stringify(mixed(k))}` },
  { name: "h", store: (target, k) => { target.h = mixed(k + 1); }, text: k => `"h":${JSON.stringify(mixed(k + 1))}` },
];

const blocks = [[0, 4], [1, 5], [2, 6], [3, 7]];
function orderAt(index: number): number[] {
  const remaining = [0, 1, 2, 3];
  const order: number[] = [];
  let rest = index;
  for (let radix = 4; radix >= 1; radix--) {
    const pick = rest % radix;
    rest = (rest - pick) / radix;
    order.push(...blocks[remaining.splice(pick, 1)[0]!]!);
  }
  return order;
}
const orders = Array.from({ length: 24 }, (_, index) => orderAt(index));

function createObjects(first: number, end: number): number {
  let mismatches = 0;
  for (let k = first; k < end; k++) {
    const target: Sparse = {};
    let names = "";
    const parts: string[] = [];
    for (const index of orders[k % orders.length]!) {
      const field = fields[index]!;
      field.store(target, k);
      names += field.name;
      parts.push(field.text(k));
    }
    let listed = "";
    for (const key in target) listed += key;
    if (Object.keys(target).join("") !== names) mismatches++;
    if (JSON.stringify(target) !== "{" + parts.join() + "}") mismatches++;
    if (listed !== names) mismatches++;
  }
  return mismatches;
}

console.log("first", createObjects(0, 10000));
const before = creationRows();
console.log("second", createObjects(10000, 20000));
console.log("level", creationRows() - before <= 500);

function tryStore(target: Sparse, index: number): string {
  try {
    fields[index]!.store(target, 1);
    return "stored";
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "other";
  }
}
const locks: [string, (target: Sparse) => void][] = [
  ["frozen", target => { Object.freeze(target); }],
  ["sealed", target => { Object.seal(target); }],
  ["not extensible", target => { Object.preventExtensions(target); }],
];
for (const [name, lock] of locks) {
  const target: Sparse = {};
  fields[0]!.store(target, 1);
  fields[6]!.store(target, 1);
  lock(target);
  console.log(name, tryStore(target, 2), tryStore(target, 7), Object.keys(target).join(), JSON.stringify(target), "c" in target, "h" in target);
}

const loose: Sparse = {};
fields[0]!.store(loose, 1);
(loose as any).outside = 1;
fields[2]!.store(loose, 1);
fields[7]!.store(loose, 1);
console.log(Object.keys(loose).join(), JSON.stringify(loose));

const twice: Sparse = {};
fields[1]!.store(twice, 1);
fields[7]!.store(twice, 1);
fields[1]!.store(twice, 2);
fields[7]!.store(twice, 2);
console.log(Object.keys(twice).join(), JSON.stringify(twice));
