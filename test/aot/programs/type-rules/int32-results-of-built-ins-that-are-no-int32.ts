// What a built-in returns is an `int32` by proof only where it cannot be anything else: not the index or the new length of an array, the length of a typed array, a buffer, a function or a rest parameter, an element of a Uint32Array, a part of a date (NaN for an invalid one), a boolean turned into a number. typed-objects/int32-math-results has what is proven.
import type { int32 } from "bun";

function indexInList(list: number[]): int32 { return list.indexOf(1); }
function newLength(list: number[]): int32 { return list.push(1); }
function unsignedElement(list: Uint32Array): int32 { return list[0]; }
function lengthOfFloats(list: Float64Array): int32 { return list.length; }
function bytes(buffer: ArrayBuffer): int32 { return buffer.byteLength; }
function day(date: Date): int32 { return date.getDay(); }
function parameters(callback: () => void): int32 { return callback.length; }
function howMany(...rest: int32[]): int32 { return rest.length; }
function plus(flag: boolean): int32 { return +flag; }
function converted(flag: boolean): int32 { return Number(flag); }
function eitherOne(a: int32, n: number): int32 { return a || n; }

console.log(indexInList([]), newLength([]), unsignedElement(new Uint32Array(1)), lengthOfFloats(new Float64Array(1)), bytes(new ArrayBuffer(1)), day(new Date(0)), parameters(() => {}), howMany(1), plus(true), converted(true), eitherOne(1, [1.5][0]));
