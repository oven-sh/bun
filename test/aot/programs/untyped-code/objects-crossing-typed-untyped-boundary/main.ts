// Objects cross between typed and untyped code: nothing is copied, no store is lost, and identity is preserved.
import { rows, offer, heldText, isHeld, makeItem, pour } from "./text.js"
import { makePrivate, sumPrivate, Tank, type Item } from "./lib"
for (const row of rows()) console.log(row.join(" | "))
// The other direction: typed code is handed objects of untyped text.
interface Mine { id: number; label: string; done: boolean }
offer((item: Mine) => { item.label = "changed" }); console.log("a callback with an annotated parameter stores |", heldText())
let got: Mine | undefined; offer((item: Mine) => { got = item }); got!.id = 10; console.log("what a callback keeps |", heldText(), isHeld(got!))
function rename(item: Item): void { item.label = "renamed" } offer(rename); console.log("a declared function as a callback |", heldText())
const made: Item = makeItem(3); made.done = true; console.log("a result in an annotated variable |", JSON.stringify(made), isHeld(made))
const tank = new Tank(); console.log("objects with methods |", pour([tank, { take(item: Mine) { item.id++; return item.id } }]), heldText(), isHeld(tank.last!))
// What does not cross.
console.log("what stays in typed code |", sumPrivate([makePrivate(1), makePrivate(2)]))
