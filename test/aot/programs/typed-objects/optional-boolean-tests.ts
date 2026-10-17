// Tests on `boolean | undefined` and `boolean | null | undefined` values read from optional fields. An absent field, a field that holds undefined, null, false and true must all answer as in JavaScript.
// SIZE< truthy 36
type Flags = { name: string; verbose?: boolean; strict?: boolean | null };
function truthy(flags: Flags): number { return flags.verbose ? 1 : 2; }
function negated(flags: Flags): boolean { return !flags.verbose; }
function doubleNegated(flags: Flags): boolean { return !!flags.verbose; }
function isTrue(flags: Flags): boolean { return flags.verbose === true; }
function isFalse(flags: Flags): boolean { return flags.verbose === false; }
function isUndefined(flags: Flags): boolean { return flags.verbose === undefined; }
function orDefault(flags: Flags): boolean { return flags.verbose ?? true; }
function orFallback(flags: Flags): boolean { return flags.verbose || false; }
function both(flags: Flags): boolean { return !!(flags.verbose && flags.strict); }
function nullableTruthy(flags: Flags): number { return flags.strict ? 1 : 2; }
function nullableIsNull(flags: Flags): boolean { return flags.strict === null; }
function nullableOrDefault(flags: Flags): boolean { return flags.strict ?? true; }
function typeIsBoolean(flags: Flags): boolean { return typeof flags.verbose === "boolean"; }
function handedOn(flags: Flags): boolean | undefined { return flags.verbose; }
function loop(flags: Flags): number { let turns = 0; while (flags.verbose && turns < 3) turns++; return turns; }
const tests: ((flags: Flags) => unknown)[] = [truthy, negated, doubleNegated, isTrue, isFalse, isUndefined, orDefault, orFallback, both, nullableTruthy, nullableIsNull, nullableOrDefault, typeIsBoolean, handedOn, loop];
const all: Flags[] = [
  { name: "absent" },
  { name: "undefined", verbose: undefined, strict: undefined },
  { name: "null", strict: null },
  { name: "false", verbose: false, strict: false },
  { name: "true", verbose: true, strict: true },
  { name: "mixed", verbose: true, strict: null },
];
const late: Flags = { name: "late" };
late.verbose = true;
all.push(late);
const removed: Flags = { name: "removed", verbose: true, strict: true };
delete removed.verbose;
delete removed.strict;
all.push(removed);
for (const flags of all) {
  const answers: string[] = [];
  for (const test of tests) answers.push(String(test(flags)));
  console.log(flags.name, answers.join());
}
let total = 0;
for (let round = 0; round < 40000; round++) {
  const flags = all[round % all.length];
  if (flags === undefined) continue;
  total += truthy(flags) + nullableTruthy(flags) + (negated(flags) ? 1 : 0) + (both(flags) ? 1 : 0) + loop(flags);
}
console.log(total);
