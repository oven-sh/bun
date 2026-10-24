const hidden = new Function("v", "return v") as <V>(v: V) => V;

function byTemplate(x: number): string { return `${x}`; }
function byPlus(x: number): string { return x + ""; }
function byString(x: number): string { return String(x); }
function byMethod(x: number): string { return x.toString(); }
function keyOf(a: number, b: number): string { return a / 2 + "," + b * 0.5; }
function half(x: number): number { return x / 2; }

const numbers = [0, -0, 1, -1, 2, 9, 10, 99, 255, 256, 1000, 65535, 123456789, 2 ** 31 - 1, 2 ** 31, -(2 ** 31), -(2 ** 31) - 1, 2 ** 32, 2 ** 53, -(2 ** 53), 0.5, -0.5, 1.5, 1e21, 1e-7, 123456.789, NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MIN_VALUE, 4294967295.5];
let digest = 0;
function note(text: string): void {
  for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0;
}
const rounds = Number(process.argv[2] ?? 20);
for (let round = 0; round < rounds; round++) {
  for (const n of numbers) {
    const x = hidden(n), doubled = hidden(n * 2);
    note(byTemplate(half(doubled))); note(byPlus(half(doubled))); note(byString(half(doubled))); note(byMethod(half(doubled)));
    note(keyOf(doubled, x * 2 + round * 2));
  }
  for (let i = 0; i < 300; i++) note(byTemplate(half(hidden(i * 2 + round * 600))));
}
// A module's top level runs once: there a conversion has its short form.
const a = hidden(84) / 2, b = hidden(-0) / 2, c = hidden(1) / 2, d = hidden(2 ** 32) / 2, e = hidden(-(2 ** 32)) / 2, f = hidden(NaN) / 2, g = hidden(2 ** 33) / 2;
console.log(digest, `${a}`, `${b}`, `${c}`, `${d}`, `${e}`, `${f}`, `${g}`, a + "", String(b), d.toString(), numbers.map(byTemplate).join(" "));
