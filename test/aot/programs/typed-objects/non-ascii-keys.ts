// Strings and property keys with non-ASCII characters and unpaired surrogates.
const a = "é \ud800"
console.log(a.length, a.charCodeAt(2), JSON.stringify(a))
const b = "\udc00x\ud83d"
console.log(b.length, b.charCodeAt(0), b.charCodeAt(2), JSON.stringify(b))
const c = "\ud83d" + "\ude00"
console.log(c.length, c, JSON.stringify(c))
const d = "😀"
console.log(d.length, d, JSON.stringify(d))
const o: Record<string, number> = { "k\ud800": 1 }
console.log(JSON.stringify(Object.keys(o)))
