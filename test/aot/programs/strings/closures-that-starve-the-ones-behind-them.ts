// Many closures stored in a Map and called only through it, some of which run very long.
const table = new Map<string, (s: string) => boolean>()
function burner(k: number): void {
  table.set("burner" + String(k), (s: string) => { let t = ""; for (let i = 0; i < 1000000; i++) t = t.length > 20 ? "x" : t + "y"; return new RegExp(s + t).test(s) })
}
function useful(name: string, prefix: string): void { table.set(name, (s: string) => new RegExp(prefix + "[0-9]+y").test(s)) }
for (let k = 0; k < 100; k++) burner(k)
useful("a", "aaa")
useful("b", "bbb")
function ask(who: string, s: string): boolean { const f = table.get(who); return f ? f(s) : false }
setTimeout(() => console.log(ask("a", "aaa1y"), ask("b", "aaa1y"), table.size), 0)
