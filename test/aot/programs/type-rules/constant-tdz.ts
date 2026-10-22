// A read of a `const` in its temporal dead zone throws a ReferenceError, also where the initializer is a constant primitive expression that the compiler folds.
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
enum Color { Red = 1, Green = 2 }
function readNumber(): number { return earlyNumber }
function readDouble(): number { return earlyDouble }
function readBoolean(): boolean { return earlyBoolean }
function readText(): string { return earlyText }
function readNull(): null { return earlyNull }
function readUndefined(): undefined { return earlyUndefined }
function typeOfIt(): string { return typeof earlyNumber }
function readComputed(): number { return earlyComputed }
function readOther(): number { return earlyOther }
function readMember(): Color { return earlyMember }
function readTemplate(): string { return earlyTemplate }
console.log("constants:", [readNumber, readDouble, readBoolean, readText, readNull, readUndefined, typeOfIt, readComputed, readOther, readMember, readTemplate].map(attempt).join())
let caught = "no"
try { readNumber() } catch { caught = "yes" }
// @ts-expect-error A read in the dead zone that is not inside a function is what this line is for.
try { caught += earlyDouble } catch (e) { caught += (e as Error).constructor.name }
console.log("caught:", caught)
function inner(): string {
  const read = () => local
  const first = attempt(read)
  const local = "set"
  return first + " " + attempt(read)
}
console.log("in a function:", inner())
// Initializers that are no constant primitive expressions.
function readLet(): number { return earlyLet }
function readObject(): { v: number } { return earlyObject }
function readCall(): number { return earlyCall }
function readLong(): string { return earlyLong }
function readOfLet(): number { return earlyOfLet }
function readClass(): unknown { return EarlyClass }
function readKindOfClass(): string { return typeof EarlyClass }
console.log("exact:", [readLet, readObject, readCall, readLong, readOfLet, readKindOfClass].map(attempt).join())
const earlyNumber: number = 5, earlyDouble: number = 0.5, earlyBoolean: boolean = false, earlyText: string = "", earlyNull = null, earlyUndefined = undefined
const earlyComputed = 2 * 3 + 1, earlyOther = earlyComputed - 1, earlyMember = Color.Green, earlyTemplate = `a${earlyOther}b`
let earlyLet = 5
const earlyObject = { v: 0 }, earlyCall = Math.abs(-5), earlyOfLet = earlyLet
const earlyLong = "0123456789012345678901234567890123456789012345678901234567890123456789"
class EarlyClass {}
console.log("after:", [readNumber, readDouble, readBoolean, readText, readNull, readUndefined, typeOfIt, readComputed, readOther, readMember, readTemplate].map(attempt).join())
console.log("after:", [readLet, readCall, readOfLet].map(attempt).join(), readObject().v, readLong().length, readClass() === EarlyClass)
