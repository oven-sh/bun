// An enum or a union of literals is an `int32` by proof only if every member is one: not with a fraction, -0 or 2 ** 31 among the members, with members computed when the program runs, or for an enum that is only declared. Arithmetic on an enum value is held to the range of an int32, not to that of the members, because TypeScript lets any number into a numeric enum. structural-types/an-enum-that-holds-any-number-is-taken-for-an-int32 has the enums that are accepted, with other numbers in them.
import type { int32 } from "bun";

const given: number[] = JSON.parse("[1.5]");
function compute(): number { return given[0]; }
enum Color { Red, Green, Blue }
enum Odd { Half = 0.5, One = 1 }
enum Big { Huge = 2147483648, One = 1 }
enum Made { First = compute(), Second = "abc".length, Third = Color.Blue }
enum Minus { Zero = -0, One = 1 }
declare enum Ambient { A, B }
function withAFraction(value: Odd): int32 { return value; }
function withAHugeMember(value: Big): int32 { return value; }
function computed(value: Made): int32 { return value; }
function withNegativeZero(value: Minus): int32 { return value; }
function oneComputedMember(value: Made.First): int32 { return value; }
function theComputedMember(): int32 { return Made.First; }
function theLength(): int32 { return Made.Second; }
function theFraction(): int32 { return Odd.Half; }
function theNegativeZero(): int32 { return Minus.Zero; }
function onlyDeclared(value: Ambient): int32 { return value; }
function negated(color: Color): int32 { return -color; }
function doubled(color: Color): int32 { return color * 2; }
function next(color: Color): int32 { return color + 1; }
function distance(color: Color): int32 { return Math.abs(color); }
function fractionOrTwo(value: 1.5 | 2): int32 { return value; }
const holder: { digit: 0 | 1 | 2 } = { digit: 1 };
const member: int32 = holder.digit;

console.log(withAFraction(1), withAHugeMember(1), computed(given[0]), withNegativeZero(1), oneComputedMember(given[0]), theComputedMember(), theLength(), theFraction(), theNegativeZero(), onlyDeclared(given[0]), negated(1), doubled(1), next(1), distance(1), fractionOrTwo(2), member);
