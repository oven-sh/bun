// Truthiness, the null check and typeof over every kind of value, in hot and in cold code.
function t(x) { return x ? 1 : 0 }
function b(x) { return !!x }
function n(x) { return x == null }
function isUndefined(x) { return typeof x === "undefined" }
function isObject(x) { return typeof x === "object" }
function isBoolean(x) { return typeof x === "boolean" }
function isNumber(x) { return typeof x === "number" }
function isString(x) { return typeof x === "string" }
function isSymbol(x) { return typeof x === "symbol" }
function isBigInt(x) { return typeof x === "bigint" }
function isFunction(x) { return typeof x === "function" }

const tests = { t, b, n, isUndefined, isObject, isBoolean, isNumber, isString, isSymbol, isBigInt, isFunction }

const values = [
  ["undefined", undefined],
  ["null", null],
  ["true", true],
  ["false", false],
  ["0", 0],
  ["-0", -0],
  ["NaN", NaN],
  ["1", 1],
  ["1.5", 1.5],
  ['""', ""],
  ['"a"', "a"],
  ["0n", 0n],
  ["1n", 1n],
  ["Symbol()", Symbol()],
  ["{}", {}],
  ["[]", []],
  ["function", function () {}],
  ["class", class {}],
  ["Proxy of a function", new Proxy(function () {}, {})],
]

function countInLoop(test, value) {
  let count = 0
  for (let i = 0; i < 2000; i++) {
    if (test(value)) count++
  }
  return count
}

for (const [label, value] of values) {
  const answers = []
  for (const name in tests) {
    const test = tests[name]
    answers.push(`${name}=${Number(test(value))}/${countInLoop(test, value)}`)
  }
  console.log(label, answers.join(" "))
}

function countTruthyInMixedLoop() {
  let count = 0
  for (let round = 0; round < 200; round++) {
    for (const [, value] of values) {
      if (value) count++
    }
  }
  return count
}
console.log("truthy in a mixed loop", countTruthyInMixedLoop())

for (const value of ["", 0n, -0, NaN]) {
  console.log("falsy", t(value), b(value), countInLoop(t, value))
}
console.log(typeof null, isObject(null), countInLoop(isObject, null))
console.log(typeof class {}, isFunction(class {}), countInLoop(isFunction, class {}))
