// `Buffer.byteLength` of strings of every internal representation.
// CALLS+ ofText StringUTF8Length8
// CALLS+ ofTextByDefault StringUTF8Length8
// CALLS+ ofTextsWithHyphen StringUTF8Length8
// CALLS+ ofUnknown StringUTF8Length8
// CALLS- ofLatin1 StringUTF8Length8
// CALLS- ofEncoding StringUTF8Length8
// JSCALLS+ ofText StringUTF8Length8
// JSCALLS- ofLatin1 StringUTF8Length8
const g = globalThis as any
if (!g.Buffer) {
  g.Buffer = {
    byteLength(value: any, encoding?: any) {
      if (typeof value !== "string") {
        if (value && typeof value.byteLength === "number") return value.byteLength
        const error: any = new TypeError("The \"string\" argument must be of type string or an instance of Buffer or ArrayBuffer.")
        error.code = "ERR_INVALID_ARG_TYPE"
        throw error
      }
      if (encoding === "latin1") return value.length
      if (encoding === "hex") return value.length >>> 1
      if (encoding === "ucs2") return value.length * 2
      let bytes = 0
      for (let i = 0; i < value.length; i++) {
        const unit = value.charCodeAt(i)
        if (unit < 0x80) bytes += 1
        else if (unit < 0x800) bytes += 2
        else if (unit >= 0xd800 && unit < 0xdc00 && i + 1 < value.length && (value.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { bytes += 4; i++ }
        else bytes += 3
      }
      return bytes
    },
  }
}
function ofText(s: string): number { return Buffer.byteLength(s, "utf8") }
function ofTextByDefault(s: string): number { return Buffer.byteLength(s) }
function ofTextWithHyphen(s: string): number { return Buffer.byteLength(s, "utf-8") }
function ofTextsWithHyphen(list: string[]): number { let n = 0; for (const s of list) n += Buffer.byteLength(s, "utf-8"); return n }
function ofLatin1(s: string): number { return Buffer.byteLength(s, "latin1") }
function ofEncoding(s: string, encoding: BufferEncoding): number { return Buffer.byteLength(s, encoding) }
function ofUnknown(s: any): number { return Buffer.byteLength(s, "utf8") }
g.kept = [ofText, ofTextByDefault, ofTextWithHyphen, ofTextsWithHyphen, ofLatin1, ofEncoding, ofUnknown]
const fresh = (x: string): string => String.fromCharCode(...[...x].map(c => c.charCodeAt(0)))
const ascii = fresh("<div class=\"a\">hello</div>")
const latin1 = fresh("na\xefve caf\xe9 \xff\x80\x7f")
const wide = fresh("│ wide é")
const texts = [fresh(""), ascii, latin1, wide, ascii + latin1, (ascii + latin1).slice(3, 30), ascii.slice(1), latin1 + wide, fresh("\x80"), fresh("\x7f")]
for (const f of g.kept.slice(0, 3) as ((s: string) => number)[]) console.log(texts.map(t => f(t)).join(" "))
console.log(texts.map(t => ofTextsWithHyphen([...t])).join(" "))
console.log((["utf8", "utf-8", "latin1", "hex", "ucs2"] as BufferEncoding[]).map(e => texts.map(t => ofEncoding(t, e)).join(" ")).join(" | "))
console.log(texts.map(t => ofUnknown(t)).join(" "), ofUnknown(new Uint8Array(7)), ofUnknown(new ArrayBuffer(9)))
for (const bad of [1, null, undefined, true, {}, []]) {
  try { console.log(ofUnknown(bad)) } catch (e: any) { console.log(e instanceof TypeError, e.code) }
}
let sum = 0
for (let i = 0; i < 1000; i++) sum += ofText(texts[i % texts.length]) + ofUnknown(texts[(i + 3) % texts.length])
console.log(sum)
console.log(ofText(ascii), ofTextByDefault(latin1), ofUnknown(wide), ofTextsWithHyphen(texts))
const { byteLength } = Buffer
console.log(byteLength(latin1, "utf8"), byteLength.call(undefined, wide))
