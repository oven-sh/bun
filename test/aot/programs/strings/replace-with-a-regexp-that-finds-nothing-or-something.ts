// `replace` with a RegExp that matches nothing, once or several times.
declare const console: { log(...a: unknown[]): void }
const g: any = globalThis
const collect: () => void = g.fullGC ? () => { g.fullGC(); g.fullGC() } : () => { g.Bun.gc(true); g.Bun.gc(true) }
function rep(s: string, r: RegExp, x: string): string { return s.replace(r, x) }
const reps: ((s: string, r: RegExp, x: string) => string)[] = [rep]
function sum(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }
function statics(): string { const R: any = RegExp; return R.lastMatch + "," + R.$1 + "," + R.$2 + "," + R.leftContext.length }
const literals: RegExp[] = [/b+/, /b+/g, /B+/i, /B+/gi, /^b/m, /b$/gm, /a.b/s, /a.b/, /\u{62}c/u, /\u{62}c/gu, /b/y, /b/gy, /(b)(c)?/, /(b)(c)?/g, /(?<n>b)\k<n>/, /(?<n>b)\k<n>/g, /(?<=a)b/, /(?<=a)b/g, /(?=(b+))\1c/, /[^\x00-\x7f]/, /[^\x00-\x7f]/g, /zzzzzzzzzzzzzzzzzzzz/, /z/g, /z/, /^(?:foo|bar)$/, /x*/, /x*/g, /(?:)/, /(?:)/g, /\d{3,}/g, /a{40}/, /a{40}/g, /[bq][bq]c/, /[bq][bq]c/gi, /\babc\b/, /(a|ab)(c|bcd)(d*)/, /^$/, /^$/g, /b+?c/d, /[\w-]+@[\w-]+/g]
const salt = String(Date.now()).length > 3 ? "" : "never"
const made: RegExp[] = [new RegExp(salt + "b+"), new RegExp(salt + "b+", "g"), new RegExp(salt + "(b)(c)?", "gi"), new RegExp(salt + "qq[a-f]{2}", "g"), new RegExp(salt + "z")]
function joined(w: string): string { let a = "", b = ""; for (let i = 0; i < w.length; i++) { if (i < 2) a += w[i]; else b += w[i] } return a + b }
const wide = "\u4e00"
const flat: string[] = ["", "a", "abc", "abbbc", "xyz", "ABBC", "a\nb", "foo", "bar", "123", "12", "me@there and you@here", "qbc QBC", "abcd", "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy", "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyabbc", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
const subjects: [string, () => string][] = []
for (const s of flat) subjects.push(["flat " + s.length, () => s])
for (const s of ["abbbc", "xyzxyz", "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyybb"]) subjects.push(["rope " + s.length, () => joined(s)])
for (const s of ["ab" + wide, wide, "xy" + wide + "z", wide + "abbc"]) subjects.push(["16 bits " + s.length, () => s])
const replacements: string[] = ["", "X", "[$&]", "$1-$2", "$<n>$$"]
const indices: number[] = [0, 2, 100, -1, 1.5, NaN]
function all(name: string, rs: RegExp[]): void {
  for (const r of rs) {
    let line = ""
    for (const [, make] of subjects) for (const x of replacements) for (const at of indices) {
      r.lastIndex = at
      const out = reps[0](make(), r, x)
      line += out + "|" + r.lastIndex + "|" + statics() + ";"
    }
    console.log(name + " " + r.source.slice(0, 24) + " /" + r.flags + " " + line.length + " " + sum(line))
  }
}
all("literal", literals)
all("made", made)
collect()
all("literal, behind two full collections", literals)
function tell(name: string, f: () => string): void { let out: string; try { out = f() } catch (e: any) { out = "threw " + e.name + ": " + e.message } console.log(name + ": " + out) }
function state(r: any): string { return "|" + String(r.lastIndex) + "|" + statics() }
const log: string[] = []
for (const s of ["xyz", "abbc"]) {
  for (const flags of ["", "g"]) {
    const fresh = (): RegExp => new RegExp("b+", flags)
    tell(s + " /" + flags + " frozen", () => { const r = Object.freeze(fresh()); return reps[0](s, r, "X") + state(r) })
    tell(s + " /" + flags + " frozen literal", () => { const r = Object.freeze(flags ? /b+c/g : /b+c/); return reps[0](s, r, "X") + state(r) })
    tell(s + " /" + flags + " sealed", () => { const r = Object.seal(fresh()); return reps[0](s, r, "X") + state(r) })
    tell(s + " /" + flags + " lastIndex not writable", () => { const r = fresh(); Object.defineProperty(r, "lastIndex", { writable: false, value: 1 }); return reps[0](s, r, "X") + state(r) })
    tell(s + " /" + flags + " an own property", () => { const r: any = fresh(); r.mine = 1; return reps[0](s, r, "X") + state(r) })
    tell(s + " /" + flags + " an own exec", () => { const r: any = fresh(); let n = 0; r.exec = function (): null { n++; return null }; return reps[0](s, r, "X") + state(r) + " asked " + n })
    tell(s + " /" + flags + " lastIndex a string", () => { const r: any = fresh(); r.lastIndex = "1"; return reps[0](s, r, "X") + state(r) })
    tell(s + " /" + flags + " lastIndex an object", () => { const r: any = fresh(); let n = 0; r.lastIndex = { valueOf() { n++; return 1 } }; return reps[0](s, r, "X") + "|" + typeof r.lastIndex + " asked " + n })
    tell(s + " /" + flags + " lastIndex undefined", () => { const r: any = fresh(); r.lastIndex = undefined; return reps[0](s, r, "X") + state(r) })
    tell(s + " /" + flags + " a subclass", () => { class Mine extends RegExp {} const r = new Mine("b+", flags); return reps[0](s, r, "X") + state(r) })
    tell(s + " /" + flags + " a subclass with exec", () => { let n = 0; class Mine extends RegExp { exec(t: string): RegExpExecArray | null { n++; return super.exec(t) } } const r = new Mine("b+", flags); return reps[0](s, r, "X") + state(r) + " asked " + n })
    tell(s + " /" + flags + " compiled anew", () => { const r: any = fresh(); reps[0](s, r, "X"); r.compile("y+", flags); return reps[0](s, r, "X") + "," + reps[0]("abbc", r, "X") + state(r) })
    tell(s + " /" + flags + " no prototype", () => { const r: any = fresh(); Object.setPrototypeOf(r, null); return reps[0](s, r, "X") })
  }
}
console.log(log.length)
