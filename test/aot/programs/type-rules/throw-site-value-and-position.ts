// What a throw site reports, the value and the position, in a hot loop, in cold code and inside try. Values that fit print results.
interface Point { x: number }
function hide(v: unknown): any { return v }
function describeError(error: unknown): string {
  const e = error as Error
  const position = /:(\d+):(\d+)\)?\s*$/m.exec(e.stack ?? "")
  return e.name + ": " + e.message.split("\n")[0].replace(/ \(bun compile[^)]*\)/, "").replace(" | undefined", "") + " | " + (position ? position[1] + ":" + position[2] : "no position")
}
function describeErrorLine(error: unknown): string { return describeError(error).replace(/:\d+$/, "") }
function printResult(name: string, f: () => unknown): void { try { console.log(name, "|", String(f())) } catch (error) { console.log(name, "|", describeError(error)) } }
function printResultLine(name: string, f: () => unknown): void { try { console.log(name, "|", String(f())) } catch (error) { console.log(name, "|", describeErrorLine(error)) } }
function coldText(v: any): string { const t: string = v; return t }
function hotText(v: any, count: number): number { let total = 0; for (let i = 0; i < count; i++) { const t: string = v; total += t.length } return total }
function guardedText(v: any): unknown { try { const t: string = v; return t } catch (error) { return describeError(error) } }
function coldNumber(v: any): number { const n: number = v; return n }
function hotNumber(v: any, count: number): number { let total = 0; for (let i = 0; i < count; i++) { const n: number = v; total += n } return total }
function guardedNumber(v: any): unknown { try { const n: number = v; return n } catch (error) { return describeError(error) } }
function coldDouble(n: number): string { const hidden: any = n * 0.5; const t: string = hidden; return t }
function hotDouble(n: number, count: number): number { let total = 0; for (let i = 0; i < count; i++) { const hidden: any = n * 0.5; const t: string = hidden; total += t.length } return total }
function guardedDouble(n: number): unknown { try { const hidden: any = n * 0.5; const t: string = hidden; return t } catch (error) { return describeError(error) } }
function coldInteger(n: number): string { const hidden: any = n | 0; const t: string = hidden; return t }
function hotInteger(n: number, count: number): number { let total = 0; for (let i = 0; i < count; i++) { const hidden: any = n | 0; const t: string = hidden; total += t.length } return total }
function guardedInteger(n: number): unknown { try { const hidden: any = n | 0; const t: string = hidden; return t } catch (error) { return describeError(error) } }
function coldRead(p: Point): number { return p.x }
function hotRead(p: Point, count: number): number { let total = 0; for (let i = 0; i < count; i++) { total += p.x } return total }
function guardedRead(p: Point): unknown { try { return p.x } catch (error) { return describeError(error) } }
function coldStore(p: Point): number { p.x = 1; return p.x }
function hotStore(p: Point, count: number): number { let total = 0; for (let i = 0; i < count; i++) { p.x = i; total += p.x } return total }
function guardedStore(p: Point): unknown { try { p.x = 1; return p.x } catch (error) { return describeError(error) } }
function coldIterate(list: number[]): number { let total = 0; for (const x of list) total += x; return total }
function hotIterate(list: number[], count: number): number { let total = 0; for (let i = 0; i < count; i++) { for (const x of list) total += x } return total }
function guardedIterate(list: number[]): unknown { try { let total = 0; for (const x of list) total += x; return total } catch (error) { return describeErrorLine(error) } }
function coldDeadZone(early: boolean): number { const read = () => late; if (early) return read(); const late = 1; return read() }
function hotDeadZone(early: boolean, count: number): number { const read = () => late; let total = 0; for (let i = 0; i < count; i++) { if (early) total += read() } const late = 1; return total + read() }
function guardedDeadZone(early: boolean): unknown { try { const read = () => late; if (early) return read(); const late = 1; return read() } catch (error) { return describeErrorLine(error) } }
function coldError(bad: boolean): string { if (bad) throw new RangeError("too far"); return "fine" }
function hotError(bad: boolean, count: number): number { let total = 0; for (let i = 0; i < count; i++) { if (bad) throw new RangeError("too far"); total += 1 } return total }
function guardedError(bad: boolean): unknown { try { if (bad) throw new RangeError("too far"); return "fine" } catch (error) { return describeError(error) } }
printResult("number as string cold", () => coldText(hide(5)))
printResult("number as string hot", () => hotText(hide(5), 1000))
printResult("number as string try", () => guardedText(hide(5)))
printResult("string as number cold", () => coldNumber(hide("wrong")))
printResult("string as number hot", () => hotNumber(hide("wrong"), 1000))
printResult("string as number try", () => guardedNumber(hide("wrong")))
printResult("object as string cold", () => coldText(JSON.parse("{}")))
printResult("object as string hot", () => hotText(JSON.parse("{}"), 1000))
printResult("object as string try", () => guardedText(JSON.parse("{}")))
printResult("unboxed double cold", () => coldDouble(3))
printResult("unboxed double hot", () => hotDouble(3, 1000))
printResult("unboxed double try", () => guardedDouble(3))
printResult("unboxed integer cold", () => coldInteger(3))
printResult("unboxed integer hot", () => hotInteger(3, 1000))
printResult("unboxed integer try", () => guardedInteger(3))
printResult("read of null cold", () => coldRead(hide(null)))
printResult("read of null hot", () => hotRead(hide(null), 1000))
printResult("read of null try", () => guardedRead(hide(null)))
printResult("store to undefined cold", () => coldStore(hide(undefined)))
printResult("store to undefined hot", () => hotStore(hide(undefined), 1000))
printResult("store to undefined try", () => guardedStore(hide(undefined)))
printResultLine("iteration of null cold", () => coldIterate(hide(null)))
printResultLine("iteration of null hot", () => hotIterate(hide(null), 1000))
printResultLine("iteration of null try", () => guardedIterate(hide(null)))
printResultLine("dead zone cold", () => coldDeadZone(true))
printResultLine("dead zone hot", () => hotDeadZone(true, 1000))
printResultLine("dead zone try", () => guardedDeadZone(true))
printResult("thrown error cold", () => coldError(true))
printResult("thrown error hot", () => hotError(true, 1000))
printResult("thrown error try", () => guardedError(true))
printResult("undefined passes cold", () => coldNumber(hide(undefined)))
printResult("undefined passes hot", () => hotNumber(hide(undefined), 2))
printResult("undefined passes try", () => guardedNumber(hide(undefined)))
printResult("string fits cold", () => coldText(hide("ok")))
printResult("string fits hot", () => hotText(hide("ok"), 2))
printResult("string fits try", () => guardedText(hide("ok")))
printResult("number fits cold", () => coldNumber(hide(2.5)))
printResult("number fits hot", () => hotNumber(hide(2.5), 2))
printResult("number fits try", () => guardedNumber(hide(2.5)))
printResult("read fits cold", () => coldRead({ x: 4 }))
printResult("read fits hot", () => hotRead({ x: 4 }, 2))
printResult("read fits try", () => guardedRead({ x: 4 }))
printResult("store fits cold", () => coldStore({ x: 0 }))
printResult("store fits hot", () => hotStore({ x: 0 }, 2))
printResult("store fits try", () => guardedStore({ x: 0 }))
printResult("iteration fits cold", () => coldIterate([1, 2]))
printResult("iteration fits hot", () => hotIterate([1, 2], 2))
printResult("iteration fits try", () => guardedIterate([1, 2]))
printResult("initialized cold", () => coldDeadZone(false))
printResult("initialized hot", () => hotDeadZone(false, 2))
printResult("initialized try", () => guardedDeadZone(false))
printResult("no error cold", () => coldError(false))
printResult("no error hot", () => hotError(false, 2))
printResult("no error try", () => guardedError(false))
