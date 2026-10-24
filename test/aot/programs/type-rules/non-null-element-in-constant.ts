// `const x = a[i]!` whose every use is a comparison, arithmetic on numbers or a test asserts nothing, like `a[i]!` written
// in those places. The same goes for `switch (a[i]!)`, and for any other use.
function lastDue(offsets: number[], end: number) {
  let last = -1
  for (;;) {
    const next = offsets[last + 1]!
    if (!(next <= end)) break
    last++
  }
  return last
}
console.log(lastDue([1, 2, 3], 10), lastDue([1, 2, 30], 10), lastDue([], 10))

function describe(list: number[], i: number) {
  const value = list[i]!
  const other = list[i + 1]!
  let total = 100
  total += value
  return [value < 15, value >= 15, value < other, value + 1, value * other, -value, value | 0, value === 10, value !== other, !value, typeof value, value ? "truthy" : "falsy", value || "none", total].join(" ")
}
function tests(list: number[], i: number) {
  const value = list[i]!
  let seen = ""
  if (value) seen += "if "
  if (value && i >= 0) seen += "and "
  if (!value || i < 0) seen += "or "
  while (value > 100) seen += "never "
  switch (value) { case 10: seen += "ten"; break; case 20: seen += "twenty"; break; default: seen += "other" }
  return seen
}
function words(list: string[], i: number) {
  const word = list[i]!
  return [word < "b", word >= "b", word === "a", !word, typeof word, word || "none"].join(" ")
}
function inAClosure(list: number[], i: number) {
  const value = list[i]!
  return [1, 2].map(k => (value < 15 ? k : -k)).join()
}
function kind(text: string, i: number) {
  switch (text[i]!) { case "a": return 1; case "b": return 2; default: return 0 }
}
function count(list: number[], i: number) {
  switch (list[i]!) { case 10: return "ten"; case 20: return "twenty" }
  return "none"
}
function scan(text: string) {
  let i = 0, letters = 0
  for (;;) {
    const c = text[i]!
    if (c === " ") { i++; continue }
    if (!(c >= "a" && c <= "z")) return letters
    letters++
    i++
  }
}
for (const i of [0, 1, 2, 7, -1, 0.5]) {
  console.log(i, describe([10, 20], i), "|", describe([1.5, 2.5], i))
  console.log(tests([10, 20, 0], i), "|", words(["a", "b"], i), "|", inAClosure([10, 20], i), kind("ab", i), count([10, 20], i))
}
console.log(scan("ab cd"), scan(""), scan("a1"))

// One other use.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
function takes(n: number) { return n }
const list = [10, 20]
attempt("also passed", () => { const value = list[5]!; return value < 1 ? takes(value) : 0 })
attempt("also returned", () => { const value = list[5]!; if (value < 1) return 1; return value })
attempt("also in a template", () => { const value = list[5]!; return value < 1 ? "" : `${value}` })
attempt("also stored", () => { const value = list[5]!; const kept = { value }; return value < 1 ? kept : 0 })
attempt("also the value of &&", () => { const value = list[5]!; return value && 1 })
attempt("also a member read", () => { const value = list[5]!; return value < 1 ? 0 : value.toFixed(1) })
attempt("annotated", () => { const value: number = list[5]!; return value < 1 })
attempt("a variable that is assigned", () => { let value = list[5]!; value = 1; return value < 1 })
