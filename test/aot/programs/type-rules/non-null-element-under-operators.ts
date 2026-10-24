// `a[i]!` as an operand of `<`, `<=`, `>`, `>=` or of arithmetic on numbers asserts nothing: where the element
// is missing the operator does what it does with `undefined`. A loop may end by reading one past the end.
function lastDue(offsets: number[], end: number) {
  let last = -1
  while (offsets[last + 1]! <= end) last++
  return last
}
console.log(lastDue([1, 2, 3], 10), lastDue([1, 2, 30], 10), lastDue([], 10), lastDue([1.5, 2.5], 2))

function count(parts: number[], end: number): number {
  let last = -1
  let seen = 0
  for (; parts[last + 1]! <= end;) {
    const part = parts[++last]!
    seen += part >= 0 ? 1 : 0
  }
  return seen
}
console.log(count([0, 3, 5], 9), count([0, 3, 50], 9), count([], 9))

const integers = [10, 20, 30]
const doubles = [1.5, 2.5, 3.5]
const holes: (number | undefined)[] = [1, , 3]
const words = ["a", "b", "c"]
const floats = new Float64Array([1.5, 2.5])
const pair: [number, number] = [1, 2]
const byName: Record<string, number> = { one: 1 }
for (const i of [0, 1, 2, 3, 7, -1, 0.5, 4294967295, NaN]) {
  console.log("index", i)
  for (const list of [integers, doubles, holes]) {
    console.log(list[i]! < 15, list[i]! <= 15, list[i]! > 15, list[i]! >= 15, 15 < list[i]!, 15 >= list[i]!, list[i]! < list[i + 1]!)
    console.log(list[i]! + 1, 1 + list[i]!, list[i]! - 1, list[i]! * 2, list[i]! / 2, list[i]! % 2, list[i]! ** 2, -list[i]!, +list[i]!)
    console.log(list[i]! | 0, list[i]! & 7, list[i]! ^ 1, list[i]! << 1, list[i]! >> 1, list[i]! >>> 1, ~list[i]!)
    let total = 100
    total += list[i]!
    console.log(total)
    total = 100
    total -= list[i]!
    total *= list[i]!
    console.log(total)
    total = 100
    total |= list[i]!
    console.log(total)
  }
  console.log(words[i]! < "b", words[i]! >= "b", "b" > words[i]!, words[i]! < words[i + 1]!)
  console.log("abc"[i]! < "b", "abc"[i]! >= "b")
  console.log(floats[i]! < 2, floats[i]! + 1, floats[i]! * floats[i + 1]!)
  console.log(pair[i]! < 2, pair[i]! + 1)
}
console.log(byName["one"]! < 2, byName["two"]! < 2, byName["two"]! + 1)
const few: (1 | 2 | 3)[] = [1, 2]
console.log(few[0]! < 2, few[5]! < 2, few[5]! + 1)

// A test only asks.
function tests(list: number[], i: number) {
  return [list[i]! ? "truthy" : "falsy", !list[i]!, list[i]! === 10, list[i]! !== 10, typeof list[i]!].join(" ")
}
console.log(tests(integers, 0), tests(integers, 3))
if (integers[3]! && integers[0]!) console.log("not reached")

function sorted(list: number[]) {
  for (let i = 0; i < list.length; i++) {
    if (list[i]! > list[i + 1]!) return false
  }
  return true
}
console.log(sorted([1, 2, 3]), sorted([1, 3, 2]), sorted([]))
