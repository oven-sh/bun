// A method that the program replaces with a function of type `any`: the result of that function is checked
// against the method's return type, like the result of a function stored in a variable of the method's type.
type Answer = { ok: true; value: string } | { ok: false; error: string }
class Client {
  constructor(readonly base: string) {}
  get(id: number): Answer { return { ok: true, value: this.base + id } }
  async later(id: number): Promise<Answer> { return this.get(id) }
}
const client = new Client("real")
function nameOf(id: number) { const answer = client.get(id); return answer.ok ? answer.value : answer.error }
async function nameLater(id: number) { const answer = await client.later(id); return answer.ok ? answer.value : answer.error }
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
attempt("the method", () => nameOf(1))
const real = client.get
client.get = () => ({ ok: false, error: "typed" })
attempt("a function of the method's type", () => nameOf(1))
const named = { ok: false, error: "named" }
client.get = (() => named) as any
attempt("an object with a name of its own", () => nameOf(1))
const functions: any[] = [() => ({ ok: true, value: "listed" })]
client.get = functions[0]
attempt("a function out of an array of any", () => nameOf(1))
client.get = real
attempt("the method again", () => nameOf(2))
const late = { ok: true, value: "late" }
client.later = (async () => late) as any
console.log(await nameLater(1))
