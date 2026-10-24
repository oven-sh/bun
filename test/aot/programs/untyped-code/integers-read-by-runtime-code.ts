// Objects of the program's own types hold whole numbers of which the compiler can tell how large they get. Functions made at run time read them, ask for them with `in`, compare them and add them up.
interface Byte { value: number; other: string }
interface SignedByte { value: number; other: string }
interface Short { value: number; other: string }
interface SignedShort { value: number; other: string }
interface Word { value: number; other: string }
interface UnsignedWord { value: number; other: string }
interface Large { value: number; other: string }
interface Several { a: number; b: number; c: number; d: number; e: boolean; f: number }
const byte = (i: number): Byte => ({ value: i, other: "byte" });
const signedByte = (i: number): SignedByte => ({ value: i, other: "signed byte" });
const short = (i: number): Short => ({ value: i, other: "short" });
const signedShort = (i: number): SignedShort => ({ value: i, other: "signed short" });
const word = (i: number): Word => ({ value: i, other: "word" });
const unsignedWord = (i: number): UnsignedWord => ({ value: i, other: "unsigned word" });
const large = (i: number): Large => ({ value: i, other: "large" });
const lines: string[] = [];
const read = new Function("o", "return o.value;") as (o: unknown) => number;
const readEach: Record<string, (o: unknown) => unknown> = Object.create(null);
const reader = (kind: string) => (readEach[kind] ??= new Function("o", "return [o.value, 'value' in o, o.value === 1, o.value === undefined, o.value + 1, -o.value, typeof o.value, o.value ? 'truthy' : 'falsy', o.other].join(' ');") as (o: unknown) => unknown);
const say = (kind: string, values: unknown[]) => {
  for (let turn = 0; turn < 4; turn++) {
    const seen = values.map(value => reader(kind)(value)).join(" | ");
    if (!turn) lines.push(kind + ": " + seen);
    else if (lines[lines.length - 1] !== kind + ": " + seen) lines.push(kind + " DIFFERS: " + seen);
  }
};
say("one", [byte(1)]);
say("bytes", [byte(0), byte(1), byte(200), byte(255)]);
say("signed bytes", [signedByte(-128), signedByte(-1), signedByte(0), signedByte(127)]);
say("shorts", [short(0), short(256), short(65535)]);
say("signed shorts", [signedShort(-32768), signedShort(-129), signedShort(1), signedShort(32767)]);
say("words", [word(-2147483648), word(-32769), word(1), word(2147483647)]);
say("unsigned words", [unsignedWord(0), unsignedWord(2147483648), unsignedWord(4294967295)]);
say("large", [large(-9007199254740991), large(-2147483649), large(1), large(4294967296), large(9007199254740991)]);
say("all at one place", [byte(255), signedByte(-128), short(65535), signedShort(-32768), word(-2147483648), unsignedWord(4294967295), large(9007199254740991), { value: 1.5, other: "plain" }, { other: "none" }]);

const several: Several = { a: 1, b: -2, c: 300, d: -40000, e: true, f: 5000000000 };
const sumOf = new Function("o", "return o.a + o.b + o.c + o.d + (o.e ? 1 : 0) + o.f;") as (o: unknown) => number;
let sum = 0;
for (let turn = 0; turn < 100000; turn++) {
  several.a = turn & 255;
  several.b = -(turn & 127);
  several.c = turn & 65535;
  several.d = -(turn & 32767);
  several.e = (turn & 1) === 0;
  sum += sumOf(several);
}
lines.push("sums: " + sum);
let total = 0;
const list = [byte(7), byte(250)];
for (let turn = 0; turn < 100000; turn++) total += read(list[turn & 1]);
lines.push("one site, one type: " + total);
const store = new Function("o", "v", "o.value = v; return o.value;") as (o: unknown, v: unknown) => unknown;
const target = byte(3);
lines.push("stored from outside: " + [4, 255, 0].map(v => store(target, v) + "/" + target.value).join(" "));
console.log(lines.join("\n"));
