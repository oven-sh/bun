// Three classes that have nothing else in common have a field under the same symbol, at different places among their fields. One function reads all of them.
export {};

const kSize = Symbol("size");
class Front {
  [kSize]: number;
  a = 1;
  b = 2;
  constructor(size: number) {
    this[kSize] = size;
  }
}
class Back {
  a = "a";
  b = "b";
  c = "c";
  [kSize]: number;
  constructor(size: number) {
    this[kSize] = size;
  }
}
class Text {
  [kSize]: string;
  constructor(size: string) {
    this[kSize] = size;
  }
}
function sizeOf(object: Front | Back | Text | { [kSize]: boolean }): number | string | boolean {
  return object[kSize];
}
const all = [new Front(1), new Back(2), new Text("three"), { [kSize]: true }, new Front(5)];
const seen: string[] = [];
for (let round = 0; round < 300; round++)
  for (let index = 0; index < all.length; index++) seen[index] = String(sizeOf(all[index]));
console.log(seen.join());
