// A Map, a Set, a typed array, a regular expression and a Date in a place are facts: their uses are compiled in line. And what an operation makes is a fact whatever its class: no test stands between `new ArrayBuffer()` and its `byteLength`.
// IR= 1 sum : Uint8Array = Cast
// IR= 1 count : Map = Cast
// IR= 1 count : Set = Cast
// IR= 1 flagsOf : RegExp = Cast
// IR= 1 timeOf : Date = Cast
// IR= 0 sum HasOriginalStructure
// IR= 1 made : Date = CallBuiltin Date
// IR= 1 made CallBuiltin .* Date.getTime
// IR= 0 made HasOriginalStructure
// IR= 1 size : ArrayBuffer = CallBuiltin ArrayBuffer
// IR= 1 size CallBuiltin .* ArrayBuffer.byteLength
function sum(bytes: Uint8Array): number { let s = 0; for (let i = 0; i < bytes.length; i++) s += bytes[i]; return s }
function count(m: Map<string, number>, s: Set<string>): number { return m.size + s.size }
function flagsOf(r: RegExp): string { return r.flags }
function timeOf(d: Date): number { return d.getTime() }
function made(ms: number): number { const d = new Date(ms); return d.getTime() }
function size(n: number): number { const b = new ArrayBuffer(n); return b.byteLength }
(globalThis as { kept?: unknown }).kept = [sum, count, flagsOf, timeOf, made, size];
let total = 0;
for (let round = 0; round < 3; round++) total += sum(new Uint8Array([1, 2, round])) + count(new Map([["a", 1]]), new Set(["x", "y"])) + flagsOf(/a/gi).length + timeOf(new Date(round)) + made(round) + size(round);
console.log(total);
