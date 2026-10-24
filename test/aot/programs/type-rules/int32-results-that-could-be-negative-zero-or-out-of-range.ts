// What could be -0, a fraction, NaN or out of range is no `int32` by proof, however small its range: a product of what can be 0 and what can be negative, a rounded quotient of a negative dividend, Math.max and Math.min with -0, a remainder or a negation of what can be 0, a shift by a count that can be 32, a `number` behind a test that -0 or a fraction passes. type-rules/int32-unproven-stores has the plain forms, typed-objects/int32-math-results what is proven.
import type { int32 } from "bun";

function timesNegative(a: int32): int32 { return ((a & 255) - 128) * -3; }
function timesZero(a: int32): int32 { return ((a & 255) - 128) * 0; }
function zeroTimesNegative(a: int32, b: int32): int32 { return (a & 255) * ((b & 255) - 128); }
function timesMinusOne(a: int32): int32 { return (a & 7) * -1; }
function signTimesZero(a: int32): int32 { return Math.sign(a) * 0; }
function smallProduct(a: int32, b: int32): int32 { return a < 100 && b < 100 && a >= 0 && b > -5 ? a * b : 0; }
function signedProduct(a: int32, b: int32): int32 { return a < 100 && b < 100 && a > -100 && b > -100 ? a * b : 0; }
function truncated(a: int32): int32 { return Math.trunc(((a & 1023) - 1) / 3); }
function roundedUp(a: int32): int32 { return Math.ceil(((a & 1023) - 1) / 3); }
function rounded(a: int32): int32 { return Math.round(((a & 1023) - 1) / 4); }
function roundedNegative(a: int32): int32 { return Math.round(-(a & 1) / 4); }
function flooredNegativeZero(a: int32): int32 { return Math.floor(-(a & 255) / 300); }
function atLeastNegativeZero(a: int32): int32 { return Math.max(a, -0); }
function atMostNegativeZero(a: int32): int32 { return Math.min(a, -0); }
function leastOfNothing(): int32 { return Math.min(); }
function distance(a: int32): int32 { return Math.abs(a); }
function remainderOfNegative(a: int32): int32 { return ((a & 255) - 128) % 8; }
function remainderByAny(a: int32, b: int32): int32 { return a >= 0 && b >= 0 ? a % b : 0; }
function negated(a: int32): int32 { return -(a & 255); }
function negatedUnlessZero(a: int32): int32 { return a !== 0 ? -a : 0; }
function squared(a: int32): int32 { return (a & 3) ** 2; }
function shiftedByAny(a: int32, b: int32): int32 { return b > 0 ? a >>> b : 0; }
function equalToZero(n: number): int32 { return n === 0 ? n : 1; }
function sameAfterOr(n: number): int32 { return (n | 0) === n ? n : 0; }
function between(n: number): int32 { return n >= 0 && n <= 10 ? n : 0; }
function wholeAndBetween(n: number): int32 { return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 0; }
function inACase(n: number): int32 { switch (n) { case 0: return n; case 5: return n; } return 1; }

console.log(timesNegative(1), timesZero(1), zeroTimesNegative(1, 1), timesMinusOne(1), signTimesZero(1), smallProduct(1, 1), signedProduct(1, 1), truncated(1), roundedUp(1), rounded(1), roundedNegative(1), flooredNegativeZero(1), atLeastNegativeZero(1), atMostNegativeZero(1), leastOfNothing(), distance(1));
console.log(remainderOfNegative(1), remainderByAny(1, 1), negated(1), negatedUnlessZero(1), squared(1), shiftedByAny(1, 1), equalToZero(1), sameAfterOr(1), between(1), wholeAndBetween(1), inACase(1));
