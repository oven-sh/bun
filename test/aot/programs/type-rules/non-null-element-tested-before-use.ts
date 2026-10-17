// `const x = a[i]!` that is tested before it is used: the test handles the missing element, as in JavaScript.
// Every use of `x` follows such a test, or is itself a test, a comparison or arithmetic on numbers.
type Box = { v: number }
const boxes: Box[] = [{ v: 1 }, { v: 2 }]
const numbers = [10, 0, 30]
const words = ["a", "", "c"]
function takes(n: number) { return n + 1 }
function early(i: number) { const box = boxes[i]!; if (!box) return "none"; return box.v }
function inside(i: number) { const box = boxes[i]!; if (box) { return box.v } return "none" }
function conditional(i: number) { const box = boxes[i]!; return box ? box.v : "none" }
function strict(i: number) { const n = numbers[i]!; if (n === undefined) return "none"; return takes(n) }
function strictOther(i: number) { const n = numbers[i]!; if (n !== undefined) return [n].length + takes(n); return "none" }
function loose(i: number) { const word = words[i]!; if (word == null) return "none"; return word.length + `<${word}>` }
function thrown(i: number) { const box = boxes[i]!; if (!box) throw new RangeError("no box " + i); return box.v }
function skipped(from: number) {
  let total = 0
  for (let i = from; i < from + 3; i++) {
    const box = boxes[i]!
    if (!box) continue
    total += box.v
    const kept = box
    total += kept.v
  }
  return total
}
function stops(from: number) {
  const seen: number[] = []
  for (let i = from; ; i++) {
    const n = numbers[i]!
    if (n === undefined) break
    seen.push(n)
  }
  return seen.join()
}
function overAJoin(i: number, flag: boolean) {
  const box = boxes[i]!
  if (!box) return "none"
  let extra = 0
  if (flag) extra = 1; else extra = 2
  return box.v + extra
}
function inALoop(i: number) {
  const box = boxes[i]!
  if (!box) return "none"
  let total = 0
  for (let k = 0; k < 3; k++) total += box.v
  return total
}
function both(i: number) { const a = boxes[i]!, b = boxes[i + 1]!; if (!a || !b) return "none"; return a.v + b.v }
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "other " + e) }
}
for (const i of [0, 1, 2, 5, -1]) {
  console.log(i, early(i), inside(i), conditional(i), strict(i), strictOther(i), loose(i), skipped(i), stops(i), overAJoin(i, i > 0), inALoop(i), both(i))
  attempt("thrown", () => thrown(i))
}

// One use that no test stands ahead of.
attempt("ahead of the test", () => { const box = boxes[5]!; const kept = [box]; if (!box) return "none"; return kept.length })
attempt("on the other side of the test", () => { const box = boxes[5]!; if (!box) return [box].length; return box.v })
attempt("in a closure behind the test", () => { const box = boxes[5]!; if (!box) return "none"; const later = () => box.v; return later() })
attempt("behind a test of something else", () => { const box = boxes[5]!, other = boxes[0]!; if (!other) return "none"; return box.v + other.v })
attempt("behind one way into a join", () => { const box = boxes[5]!; if (numbers.length > 9) { if (!box) return "none" } return [box].length })
attempt("null is not undefined", () => { const n = numbers[5]!; if (n === null) return "none"; return takes(n) })
