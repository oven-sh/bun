// `private` and `protected` are words for the type checker: at run time the object has the member. A test reaches it with
// `x as unknown as Internals`, also where the function that casts knows the object only as `object`.
class Base {
  protected id = 1
  describe() { return "base " + this.id }
}
class Screen extends Base {
  private frames = 0
  private log: string[] = []
  private size = { columns: 80, rows: 24 }
  private last?: { text: string }
  readonly name: string
  constructor(name: string, private readonly options: { debug: boolean }) { super(); this.name = name }
  private flush() { return ++this.frames }
  render(text: string) { this.log.push(text); this.last = { text }; return this.flush() }
}
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
const screen = new Screen("main", { debug: true })
screen.render("a")

type SameType = { frames: number }
type Wider = { frames: unknown }
type Union = { frames: number | string }
type Readonly = { readonly frames: number }
type Part = { size: { columns: number } }
type Whole = { size: unknown }
type Optional = { last?: { text: string } }
type Parameter = { options: { debug: boolean } }
type Method = { flush(): number }
type Inherited = { id: unknown }
type Several = { frames: unknown; log: unknown; id: unknown; name: unknown }
type ScreenInternals = { frames: number; log: string[]; readonly name: string; render(text: string): number }
function sameType(thing: object): SameType { return thing as unknown as SameType }
function wider(thing: object): Wider { return thing as unknown as Wider }
function union(thing: object): Union { return thing as unknown as Union }
function readonly(thing: object): Readonly { return thing as unknown as Readonly }
function part(thing: object): Part { return thing as unknown as Part }
function whole(thing: object): Whole { return thing as unknown as Whole }
function optional(thing: object): Optional { return thing as unknown as Optional }
function parameter(thing: object): Parameter { return thing as unknown as Parameter }
function method(thing: object): Method { return thing as unknown as Method }
function inherited(thing: object): Inherited { return thing as unknown as Inherited }
function several(thing: object): Several { return thing as unknown as Several }
function internals(thing: object): ScreenInternals { return thing as unknown as ScreenInternals }
attempt("by its own type", () => sameType(screen).frames)
attempt("by a wider type", () => wider(screen).frames)
attempt("by a union", () => union(screen).frames)
attempt("readonly", () => readonly(screen).frames)
attempt("a part of an object", () => part(screen).size.columns)
attempt("an object as unknown", () => typeof whole(screen).size)
attempt("optional", () => optional(screen).last?.text)
attempt("a parameter property", () => parameter(screen).options.debug)
attempt("a private method", () => method(screen).flush())
attempt("protected, inherited", () => inherited(screen).id)
attempt("several", () => { const all = several(screen); return [all.frames, all.log, all.id, all.name] })
attempt("private and public", () => { const inner = internals(screen); return [inner.frames, inner.log, inner.name, inner.render("b"), inner.frames] })

// A store through the other type is seen by the class.
attempt("a store", () => { internals(screen).frames = 10; return screen.render("c") })
attempt("a store through the wider type", () => { wider(screen).frames = 20; return screen.render("d") })

// Where the class is known.
class Panel {
  private rows = 3
  private title = "panel"
  grow() { return ++this.rows }
}
type PanelInternals = { rows: number; title: unknown }
function ofPanel(panel: Panel): PanelInternals { return panel as unknown as PanelInternals }
attempt("the class is known", () => { const panel = new Panel(); const inner = ofPanel(panel); inner.rows = 7; return [panel.grow(), inner.rows, inner.title] })

// A member of another type is still refused.
type Wrong = { frames: string }
function wrong(thing: object): Wrong { return thing as unknown as Wrong }
attempt("a private member of another type", () => wrong(screen).frames.length)
