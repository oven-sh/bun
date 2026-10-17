// Closures that build regular expressions are stored in a Map and called only through it.
const handlers = new Map<string, (s: string) => boolean>()
function register(name: string, prefix: string): void { handlers.set(name, (s: string) => new RegExp(prefix + "[0-9]+y").test(s)) }
register("a", "aaa")
register("b", "bbb")
function ask(who: string, s: string): boolean { const f = handlers.get(who); return f ? f(s) : false }
setTimeout(() => console.log(ask("a", "aaa1y"), ask("b", "aaa1y")), 0)
