// Two number fields that are kept in four bytes, read one behind the other and compared, subtracted, added or tested for equality, with every kind of number in either.
declare const console: { log(...values: unknown[]): void };
function show(value: unknown): string { return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value); }
class Span { kind!: number; pos!: number; end!: number; id!: number; next!: number; line!: number; column!: number; depth!: number; }
function makeSpan(kind: number, pos: number, end: number): Span { const n = new Span(); n.kind = kind; n.pos = pos; n.end = end; n.id = 0; n.next = 0; n.line = pos >> 2; n.column = pos & 3; n.depth = kind + 1; return n; }
function less(a: Span, b: Span): boolean { return a.pos < b.pos; }
function lessOrEqual(a: Span, b: Span): boolean { return a.pos <= b.end; }
function greater(a: Span, b: Span): boolean { return a.end > b.pos; }
function same(a: Span, b: Span): boolean { return a.pos === b.pos; }
function differs(a: Span, b: Span): boolean { return a.end !== b.end; }
function looselySame(a: Span, b: Span): boolean { return a.pos == b.end; }
function isEmpty(n: Span): boolean { return n.pos === n.end; }
function width(n: Span): number { return n.end - n.pos; }
function sum(a: Span, b: Span): number { return a.pos + b.pos; }
function product(a: Span, b: Span): number { return a.pos * b.end; }
function within(a: Span, b: Span): boolean { return a.pos >= b.pos && a.end <= b.end; }
function overlap(a: Span, b: Span): number { return Math.min(a.end, b.end) - Math.max(a.pos, b.pos); }
function bits(a: Span, b: Span): number { return (a.pos & b.end) | (a.end ^ b.pos); }
function which(a: Span, b: Span): string { return a.pos < b.pos ? "before" : a.pos > b.pos ? "after" : a.pos === b.pos ? "at" : "neither"; }
const spans: Span[] = []; for (let i = 0; i < 4; i++) spans.push(makeSpan(i, i * 3 - 2, i * 5));
const odd = JSON.parse("[0, -0, 0.5, -1.5, 1073741823, 1073741824, -1073741824, -1073741825, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 9007199254740992, 1e21, -1e300]") as number[];
odd.push(NaN, Infinity, -Infinity);
for (let i = 0; i < odd.length; i++) { const n = makeSpan(1, 1, 2); n.pos = odd[i]; n.end = odd[(i * 7 + 3) % odd.length]; spans.push(n); }
const bare = new Span(); bare.kind = 1; spans.push(bare);
const pairs: [string, (a: Span, b: Span) => unknown][] = [["less", less], ["lessOrEqual", lessOrEqual], ["greater", greater], ["same", same], ["differs", differs], ["looselySame", looselySame], ["sum", sum], ["product", product], ["within", within], ["overlap", overlap], ["bits", bits], ["which", which]];
const singles: [string, (n: Span) => unknown][] = [["isEmpty", isEmpty], ["width", width]];
for (const [name, f] of singles) console.log(name, spans.map(n => show(f(n))).join(" "));
for (const [name, f] of pairs) { let hash = 0; const row: string[] = []; for (const a of spans) { let line = ""; for (const b of spans) { const text = show(f(a, b)); line += text[0] + text[text.length - 1]; for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0; } row.push(line.slice(0, 12)); } console.log(name, hash, row.slice(0, 9).join(" ")); }
