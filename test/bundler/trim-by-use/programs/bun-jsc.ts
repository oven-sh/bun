import { serialize, deserialize, describe, heapSize, isRope, numberOfDFGCompiles } from "bun:jsc";
declare module "bun:jsc" {
  export function describe(value: unknown): string;
}
const bytes = serialize({ a: [1, 2, { b: new Map([[1, "one"]]) }] }) as SharedArrayBuffer | ArrayBuffer;
console.log(bytes instanceof SharedArrayBuffer || bytes instanceof ArrayBuffer, deserialize(bytes).a[2].b.get(1));
console.log(
  describe(1),
  heapSize() > 0,
  isRope("a" + String(Date.now()) + "b".repeat(40)),
  typeof numberOfDFGCompiles(() => 1),
);
