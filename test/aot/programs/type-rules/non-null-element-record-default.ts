// `a[i]! || fallback` where the whole goes to a place of a record type: a missing element is falsy, as in JavaScript.
type Box = { v: number }
type Pair = { left: Box; right: Box }
class Crate { constructor(readonly v: number) {} }
const boxes: Box[] = [{ v: 1 }, { v: 2 }]
const crates: Crate[] = [new Crate(5)]
const lists: number[][] = [[1, 2]]
const spare: Box = { v: -1 }
function takesBox(box: Box) { return box.v }
function annotated(i: number) { const kept: Box = boxes[i]! || { v: -1 }; return kept.v }
function passed(i: number) { return takesBox(boxes[i]! || { v: -1 }) }
function returned(i: number): Box { return boxes[i]! || { v: -1 } }
function named(i: number): Box { return boxes[i]! || spare }
function stored(i: number) { const pair: Pair = { left: boxes[i]! || { v: -2 }, right: boxes[i + 1]! || spare }; return pair.left.v + "," + pair.right.v }
function chained(i: number): Box { return boxes[i]! || boxes[i - 1]! || { v: -3 } }
function assigned(i: number) { let kept: Box = spare; kept = boxes[i]! || { v: -4 }; return kept.v }
function ofAClass(i: number): Crate { return crates[i]! || new Crate(-5) }
function ofArrays(i: number): number[] { return lists[i]! || [] }
function inAnArray(i: number): Box[] { return [boxes[i]! || { v: -6 }] }
const arrow = (i: number): Box => boxes[i]! || { v: -7 }
for (const i of [0, 1, 2, 7, -1]) {
  console.log(i, annotated(i), passed(i), returned(i).v, named(i).v, stored(i), chained(i).v, assigned(i), ofAClass(i).v, ofArrays(i).length, inAnArray(i)[0]!.v, arrow(i).v)
}
