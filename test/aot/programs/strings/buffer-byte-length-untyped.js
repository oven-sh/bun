// `Buffer.byteLength` of strings of every internal representation (the same program without type annotations).
const g = globalThis;
if (!g.Buffer) {
  g.Buffer = {
    byteLength(value, encoding) {
      if (typeof value !== "string") {
        if (value && typeof value.byteLength === "number")
          return value.byteLength;
        const error = new TypeError('The "string" argument must be of type string or an instance of Buffer or ArrayBuffer.');
        error.code = "ERR_INVALID_ARG_TYPE";
        throw error;
      }
      if (encoding === "latin1")
        return value.length;
      if (encoding === "hex")
        return value.length >>> 1;
      if (encoding === "ucs2")
        return value.length * 2;
      let bytes = 0;
      for (let i = 0;i < value.length; i++) {
        const unit = value.charCodeAt(i);
        if (unit < 128)
          bytes += 1;
        else if (unit < 2048)
          bytes += 2;
        else if (unit >= 55296 && unit < 56320 && i + 1 < value.length && (value.charCodeAt(i + 1) & 64512) === 56320) {
          bytes += 4;
          i++;
        } else
          bytes += 3;
      }
      return bytes;
    }
  };
}
function ofText(s) {
  return Buffer.byteLength(s, "utf8");
}
function ofTextByDefault(s) {
  return Buffer.byteLength(s);
}
function ofTextWithHyphen(s) {
  return Buffer.byteLength(s, "utf-8");
}
function ofTextsWithHyphen(list) {
  let n = 0;
  for (const s of list)
    n += Buffer.byteLength(s, "utf-8");
  return n;
}
function ofLatin1(s) {
  return Buffer.byteLength(s, "latin1");
}
function ofEncoding(s, encoding) {
  return Buffer.byteLength(s, encoding);
}
function ofUnknown(s) {
  return Buffer.byteLength(s, "utf8");
}
g.kept = [ofText, ofTextByDefault, ofTextWithHyphen, ofTextsWithHyphen, ofLatin1, ofEncoding, ofUnknown];
const fresh = (x) => String.fromCharCode(...[...x].map((c) => c.charCodeAt(0)));
const ascii = fresh('<div class="a">hello</div>');
const latin1 = fresh("na\xEFve caf\xE9 \xFF\x80\x7F");
const wide = fresh("\u2502 wide \xE9");
const texts = [fresh(""), ascii, latin1, wide, ascii + latin1, (ascii + latin1).slice(3, 30), ascii.slice(1), latin1 + wide, fresh("\x80"), fresh("\x7F")];
for (const f of g.kept.slice(0, 4))
  console.log(texts.map((t) => f(t)).join(" "));
console.log(["utf8", "utf-8", "latin1", "hex", "ucs2"].map((e) => texts.map((t) => ofEncoding(t, e)).join(" ")).join(" | "));
console.log(texts.map((t) => ofUnknown(t)).join(" "), ofUnknown(new Uint8Array(7)), ofUnknown(new ArrayBuffer(9)));
for (const bad of [1, null, undefined, true, {}, []]) {
  try {
    console.log(ofUnknown(bad));
  } catch (e) {
    console.log(e instanceof TypeError, e.code);
  }
}
let sum = 0;
for (let i = 0;i < 1000; i++)
  sum += ofText(texts[i % texts.length]) + ofUnknown(texts[(i + 3) % texts.length]);
console.log(sum);
console.log(ofText(ascii), ofTextByDefault(latin1), ofUnknown(wide), ofTextsWithHyphen(texts));
const { byteLength } = Buffer;
console.log(byteLength(latin1, "utf8"), byteLength.call(undefined, wide));
