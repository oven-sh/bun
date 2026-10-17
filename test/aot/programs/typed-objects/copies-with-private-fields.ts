// Object spread, `Object.assign` and `JSON.stringify` on instances with private fields.
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
class Model { id = 1; #secret = 2; reveal() { return this.#secret } hide(v: number) { this.#secret = v } }
const model = new Model()
const flat = { ...model }
console.log(attempt(() => Model.prototype.reveal.call(flat as Model)), model.reveal(), attempt(() => Model.prototype.hide.call(flat as Model, 1)), Reflect.ownKeys(flat).length)
