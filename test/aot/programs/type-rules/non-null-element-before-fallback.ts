// `a[i]! || fallback`: the left side is a test. Where the element is missing it is falsy, and the result is the fallback.
const numbers = [10, 0, 30]
const doubles = [1.5, 0, NaN]
const words = ["a", "", "c"]
const boxes = [{ v: 1 }]
const bytes = new Uint8Array([7, 0])
function takes(n: number) { return n + 1 }
function orZero(list: number[], i: number): number { return list[i]! || 0 }
for (const i of [0, 1, 2, 3, -1, 0.5]) {
  console.log(i, numbers[i]! || "none", doubles[i]! || -1, words[i]! || "?", bytes[i]! || 9, (boxes[i]! || { v: -1 }).v)
  const kept: number = numbers[i]! || 5
  console.log(kept, takes(numbers[i]! || 5), (numbers[i]! || 1) + 1, orZero(numbers, i), [numbers[i]! || 2].length, `${words[i]! || "empty"}`)
  console.log(numbers[i]! || doubles[i]! || 4, numbers[i + 1]! || numbers[i]! || "neither")
}
