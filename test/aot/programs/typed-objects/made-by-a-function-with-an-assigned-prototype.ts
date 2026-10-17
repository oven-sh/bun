const log: string[] = []
const show = (label: string, value: unknown) => log.push(label + ": " + String(value))
const args = "~made/args"
interface Primitive {
  readonly _tag: string
  readonly value: unknown
  describe(): string
}
type PrimitiveClass = new (value: unknown) => Primitive
function makeExit(tag: string) {
  const Proto = {
    _tag: tag,
    get value(): unknown {
      return (this as any)[args]
    },
    describe(this: Primitive) {
      return this._tag + "(" + String(this.value) + ")"
    },
  }
  const ExitPrimitive = function (this: any, value: unknown) {
    this[args] = value
  } as unknown as PrimitiveClass
  ExitPrimitive.prototype = Proto
  return { Proto: Proto as any, make: (value: unknown): Primitive => new ExitPrimitive(value) }
}
const success = makeExit("Success")
const failure = makeExit("Failure")
const tell = (made: Primitive) => [made._tag, made.value, made.describe(), "_tag" in made, Object.keys(made).join()].join(" ")
let length = 0
for (let i = 0; i < 400; i++) length += tell((i & 1 ? success : failure).make(i)).length
show("warm", length + " " + tell(success.make(1)) + " / " + tell(failure.make("x")))
success.Proto._tag = "Done"
show("the prototype's value is another string", tell(success.make(2)) + " / " + tell(failure.make(2)))
success.Proto.extra = 1
show("the prototype gets one more property", tell(success.make(3)))
Object.defineProperty(success.Proto, "_tag", { get() { return "Got" }, configurable: true, enumerable: true })
show("a value becomes a getter", tell(success.make(4)))
delete success.Proto._tag
Object.setPrototypeOf(success.Proto, { _tag: "Above" })
show("the name moves one prototype up", tell(success.make(5)))
const shadowed = success.make(6)
;(shadowed as any)._tag = "Own"
show("an own property shadows it", tell(shadowed) + " / " + tell(success.make(6)))
success.Proto.describe = function (this: Primitive) { return "<" + this._tag + ">" }
show("the method is replaced", tell(success.make(7)))
for (let i = 0; i < 400; i++) length += tell((i & 1 ? success : failure).make(i)).length
show("warm again", length)
console.log(log.join("\n"))
