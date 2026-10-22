// Each written type tests every kind of value: once from cold code and in a hot loop.
// A literal type tests the kind of the primitive only, in a parameter as in a cast.
interface HasX { x: number }
class K { x = 1 }
class ArraySubclass extends Array {}

function takesNumber(x: number) { return x }
function takesSmallIntegers(x: 0 | 1 | 2) { return x }
function takesPositiveIntegers(x: 1 | 2 | 3) { return x }
function takesBoolean(x: boolean) { return x }
function takesTrue(x: true) { return x }
function takesString(x: string) { return x }
function takesLiterals(x: "a" | "b") { return x }
function takesSymbol(x: symbol) { return x }
function takesBigInt(x: bigint) { return x }
function takesObject(x: object) { return x }
function takesInterface(x: HasX) { return x }
function takesClass(x: K) { return x }
function takesArray(x: unknown[]) { return x }
function takesMap(x: Map<string, number>) { return x }
function takesDate(x: Date) { return x }
function takesFunction(x: () => void) { return x }
function takesOptionalNumber(x: number | undefined) { return x }
function takesRequest(x: Request) { return x }
function castsNumberToSmallIntegers(x: number) { return x as 0 | 1 | 2 }
function castsNumberToPositiveIntegers(x: number) { return x as 1 | 2 | 3 }
function castsBooleanToTrue(x: boolean) { return x as true }
function castsStringToLiterals(x: string) { return x as "a" | "b" }
function castsLiteralsToFewer(x: "a" | "b" | "c") { return x as "a" | "b" }
function castsLiteralsToNumber(x: "a" | "b") { return (x as unknown) as number }

const values: any[] = [
  undefined, null, true, false, 0, -0, 1.5, NaN, 2 ** 31, 2 ** 53,
  "", "a", Symbol(), 1n, {}, [], new ArraySubclass(), function () {}, class {}, new Map(),
  new Date(0), /x/, Promise.resolve(), new Proxy({}, {}), 2, new K(), () => 1, new Proxy(function () {}, {}), Object.create(null), new Request("http://localhost/"),
  "c",
]

const checks: [string, (x: any) => unknown][] = [
  ["number", takesNumber],
  ["0 | 1 | 2", takesSmallIntegers],
  ["1 | 2 | 3", takesPositiveIntegers],
  ["boolean", takesBoolean],
  ["true", takesTrue],
  ["string", takesString],
  ['"a" | "b"', takesLiterals],
  ["symbol", takesSymbol],
  ["bigint", takesBigInt],
  ["object", takesObject],
  ["interface", takesInterface],
  ["class", takesClass],
  ["unknown[]", takesArray],
  ["Map", takesMap],
  ["Date", takesDate],
  ["() => void", takesFunction],
  ["number | undefined", takesOptionalNumber],
  ["Request", takesRequest],
  ["number as 0 | 1 | 2", castsNumberToSmallIntegers],
  ["number as 1 | 2 | 3", castsNumberToPositiveIntegers],
  ["boolean as true", castsBooleanToTrue],
  ['string as "a" | "b"', castsStringToLiterals],
  ['"a" | "b" | "c" as "a" | "b"', castsLiteralsToFewer],
  ['"a" | "b" as number', castsLiteralsToNumber],
]

function outcome(check: (x: any) => unknown, value: any, iterations: number): string {
  try {
    for (let i = 0; i < iterations; i++) check(value)
    return "ok"
  } catch (error: any) {
    return error.name
  }
}

for (const [name, check] of checks) {
  console.log(name, "once:", values.map(value => outcome(check, value, 1)).join(" "))
  console.log(name, "hot:", values.map(value => outcome(check, value, 2000)).join(" "))
}
