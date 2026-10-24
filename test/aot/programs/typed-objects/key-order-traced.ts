// Object spread, `Object.assign` and destructuring over getters and setters, with the order of all accesses recorded.
const trace: string[] = []
const getterSource = { get port() { trace.push("get port"); return 7 }, get host() { trace.push("get host"); return "g" } }
class Watched { #port = 0; host = "w"; get port() { return this.#port } set port(v: number) { trace.push("set port " + v); this.#port = v * 2 } }
const watched = new Watched()
console.log(Object.keys(watched).join(), JSON.stringify(watched))
Object.assign(watched, getterSource, { port: 1 })
console.log(watched.port, Object.keys(watched).join(), JSON.stringify(watched))
