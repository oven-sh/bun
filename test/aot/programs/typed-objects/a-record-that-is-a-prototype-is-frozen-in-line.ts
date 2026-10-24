const log: string[] = []
const show = (label: string, value: unknown) => log.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)))
const describe = (o: object) => Object.keys(o).join() + " | " + JSON.stringify(o)
interface Seen {
  a: number
  b: number
}
const Held: { a?: number } = { a: 1 }
function overHeld(a: number, b: number): Seen {
  const self = Object.create(Held)
  self.a = a
  self.b = b
  return self
}
for (let i = 0; i < 40; i++) overHeld(i, i)
show("the prototype holds the name", describe(overHeld(1, 2)))
Object.freeze(Held)
try {
  show("the prototype holds the name and is frozen", describe(overHeld(1, 2)))
} catch (error) {
  show("the prototype holds the name and is frozen", (error as Error).constructor.name)
}
console.log(log.join("\n"))
