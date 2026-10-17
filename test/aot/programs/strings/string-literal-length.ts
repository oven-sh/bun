// `.length` of string literals and of strings returned by functions.
// CALLS- ofConstant TypedString
// CALLS- ofInlined TypedString
// CALLS- ofCast TypedString
// CALLS- ofEmpty TypedString
// CALLS+ ofWide TypedString
// CALLS+ returned TypedString
// JSCALLS- ofConstant TypedString
const g = globalThis as any
function text(): string { return "returned-1" }
function ofConstant(): number { return "twelve chars".length }
function ofInlined(): number { return text().length }
function ofCast(): number { return ("a text that is cast" as string | undefined)!.length }
function ofEmpty(): number { return "".length }
function ofWide(): number { return "na\xefve ☃ 😀".length }
function returned(): string { return "a text that gets out" }
function ofGiven(s: string): number { return s.length }
function inBranch(n: number): string { return "abc".length > n ? "longer" : "not longer" }
g.kept = [ofConstant, ofInlined, ofCast, ofEmpty, ofWide, returned, ofGiven, inBranch]
const kept = g.kept as ((...given: any[]) => unknown)[]
console.log(kept[0](), kept[1](), kept[2](), kept[3](), kept[4](), kept[5](), kept[6]("four"), kept[6](""), kept[7](2), kept[7](3))
let sum = 0
for (let i = 0; i < 100; i++) sum += (kept[0]() as number) + (kept[1]() as number) + (kept[4]() as number)
console.log(sum)
