// The temporal dead zone of variables that functions capture, whatever they hold.
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function readNumber(): number { return earlyNumber }
function readDouble(): number { return earlyDouble }
function readBoolean(): boolean { return earlyBoolean }
function readText(): string { return earlyText }
function readObject(): { v: number } { return earlyObject }
function writeNumber(): void { earlyLet = 1 }
function writeConst(): void { eval("0"); }
function typeOfIt(): string { return typeof earlyNumber }
const readers = [readNumber, readDouble, readBoolean, readText, readObject, writeNumber, writeConst, typeOfIt]
console.log(readers.map(attempt).join())
let caught = "no"
try { readNumber() } catch { caught = "yes" }
// @ts-expect-error A read in the dead zone that is not inside a function is what this line is for.
try { caught += earlyDouble } catch (e) { caught += (e as Error).constructor.name }
console.log(caught)
// Not a constant expression: those are compile-time constants, see type-rules/constant-tdz.
const earlyNumber: number = Number("5"), earlyDouble: number = Number("0.5"), earlyBoolean: boolean = Boolean(0), earlyText: string = String(""), earlyObject = { v: 0 }
let earlyLet = 0
console.log(readers.map(attempt).join(), earlyLet)
function inner(mode: number): string {
  const out: string[] = []
  const get = () => count + ":" + flag + ":" + ratio, set = () => { count = 7 }
  if (mode === 0) out.push(attempt(get), attempt(set))
  let count = 1, flag = true, ratio = 1.5
  out.push(get()); set(); out.push(get())
  return out.join()
}
console.log(inner(0), inner(1))
function perTurn(): string {
  const out: string[] = []
  for (let i = 0; i < 3; i++) {
    const peek = () => here
    out.push(i === 1 ? attempt(peek) : "-")
    const here = i * 2
    out.push(String(peek()))
  }
  return out.join()
}
console.log(perTurn())
let sum = 0
function add(n: number): void { sum += n * earlyNumber + earlyDouble }
for (let i = 0; i < 30000; i++) add(i)
console.log(sum)
