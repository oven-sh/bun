// An element read out of range has the type boolean and is undefined. `!!x` and `Boolean(x)` make a boolean of whatever x is.
// Where the operand is made by an operation that always gives a boolean, nothing is converted.
// IR= 0 ofComparison ToBoolean
// IR= 0 ofNegation ToBoolean
const flags: boolean[] = [true, false];
const missing = flags[7];
console.log(!!missing, Boolean(missing), !(!missing), !!flags[7]);
console.log(!!missing === false, typeof !!missing, JSON.stringify({ on: !!missing }));
const count = (on: boolean): number => (!!on === false ? 0 : 1);
console.log(count(missing), count(flags[0]), count(flags[1]));
const held: { on: boolean } = JSON.parse("{}");
const later = held.on;
console.log(!!later, Boolean(later), !!held.on);
let late: boolean;
const readLate = (): boolean => !!late;
console.log(readLate());
late = true;
console.log(readLate());
function ofComparison(a: number, b: number): boolean { const less = a < b; return !!less; }
function ofNegation(on: boolean): boolean { const off = !on; return Boolean(off); }
console.log(ofComparison(1, 2), ofComparison(2, 1), ofNegation(true), ofNegation(false));
