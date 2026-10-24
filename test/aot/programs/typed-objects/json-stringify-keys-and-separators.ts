// Keys that need escaping, separators around members that write nothing, and objects that must take the generic answer.
// One function per type, so each JSON.stringify call site has a static type. The call is in a loop, so the site is not cold.
interface EscapedKeys {
  'a"b': number;
  "c\\d": number;
  "e\tf": number;
  "é": number;
  "g\x7fh": number;
}
interface WideKey {
  "日本": number;
  plain: number;
}
interface Three {
  a?: number;
  b?: string;
  c?: boolean;
}
interface UnknownFirst {
  value: unknown;
  next?: number;
}
interface UnknownAfterMember {
  first: number;
  value: unknown;
  last?: number;
}
interface Scalars {
  yes: boolean;
  no: boolean;
  negativeZero: number;
  large: number;
  notANumber: number;
  exact: number;
  when: Date;
}
interface Point {
  x: number;
  y: number;
}
class Pair {
  left = 1;
  right = 2;
}

function hide(value: unknown): any {
  return value;
}

function writeByShape(label: string, values: unknown[]): void {
  for (const value of values) console.log(label + ", by shape: " + JSON.stringify(value));
}

function writeEscapedKeys(label: string, values: EscapedKeys[]): void {
  for (const value of values) console.log(label + ": " + JSON.stringify(value));
  writeByShape(label, values);
}

function writeWideKeys(label: string, values: WideKey[]): void {
  for (const value of values) console.log(label + ": " + JSON.stringify(value));
  writeByShape(label, values);
}

function writeThrees(label: string, values: Three[]): void {
  for (const value of values) console.log(label + ": " + JSON.stringify(value));
  writeByShape(label, values);
}

function writeUnknownFirst(label: string, values: UnknownFirst[]): void {
  for (const value of values) console.log(label + ": " + JSON.stringify(value));
  writeByShape(label, values);
}

function writeUnknownAfterMember(label: string, values: UnknownAfterMember[]): void {
  for (const value of values) console.log(label + ": " + JSON.stringify(value));
  writeByShape(label, values);
}

function writeScalars(label: string, values: Scalars[]): void {
  for (const value of values) console.log(label + ": " + JSON.stringify(value));
  writeByShape(label, values);
}

function writePoints(label: string, values: Point[]): void {
  for (const value of values) console.log(label + ": " + JSON.stringify(value));
  writeByShape(label, values);
}

function writePairs(label: string, values: Pair[]): void {
  for (const value of values) console.log(label + ": " + JSON.stringify(value));
  writeByShape(label, values);
}

writeEscapedKeys("escaped keys", [{ 'a"b': 1, "c\\d": 2, "e\tf": 3, "é": 4, "g\x7fh": 5 }]);
writeWideKeys("wide key", [{ "日本": 1, plain: 2 }]);

for (let bits = 0; bits < 8; bits++) {
  const absent: Three = {};
  if (bits & 1) absent.a = bits;
  if (bits & 2) absent.b = "b" + bits;
  if (bits & 4) absent.c = true;
  writeThrees("absent members " + bits, [absent]);
  const undefinedMembers: Three = {
    a: bits & 1 ? bits : undefined,
    b: bits & 2 ? "b" + bits : undefined,
    c: bits & 4 ? false : undefined,
  };
  writeThrees("undefined members " + bits, [undefinedMembers]);
}

const unknownValues: unknown[] = [undefined, () => 1, 7, Symbol("left out"), null, "text"];
for (const value of unknownValues) {
  writeUnknownFirst("unknown first", [{ value }]);
  writeUnknownFirst("unknown first, then a member", [{ value, next: 2 }]);
  writeUnknownAfterMember("unknown after a member", [{ first: 1, value }]);
  writeUnknownAfterMember("unknown between members", [{ first: 1, value, last: 3 }]);
}

writeScalars("scalars", [
  {
    yes: true,
    no: false,
    negativeZero: -0,
    large: 1e21,
    notANumber: NaN,
    exact: 2 ** 53,
    when: new Date(NaN),
  },
]);

const point = (): Point => ({ x: 1, y: 2 });
writePoints("point", [point()]);
const frozen = point();
Object.freeze(frozen);
writePoints("frozen", [frozen]);
const sealed = point();
Object.seal(sealed);
writePoints("sealed", [sealed]);
const notExtensible = point();
Object.preventExtensions(notExtensible);
writePoints("not extensible", [notExtensible]);
const extended = point();
hide(extended).z = 3;
writePoints("added property", [extended]);
const withToJSON = point();
Object.setPrototypeOf(withToJSON, {
  toJSON() {
    return 1;
  },
});
writePoints("prototype with toJSON", [withToJSON]);
writePoints("point after the generic answers", [point()]);

writePairs("class instance", [new Pair()]);
const replaced = new Pair();
Object.setPrototypeOf(replaced, {
  toJSON() {
    return "replaced";
  },
});
writePairs("class instance with another prototype", [replaced]);
