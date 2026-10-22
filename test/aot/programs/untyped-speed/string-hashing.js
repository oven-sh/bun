// Integer arithmetic on the characters of strings: two hash functions, a Base64 encoder and decoder with a lookup table, and hexadecimal digits.
function fnv1a(text) {
  var hash = 0x811c9dc5;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function djb2(text) {
  var hash = 5381;
  for (var i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return hash >>> 0;
}

var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var reverse = {};
for (var n = 0; n < alphabet.length; n++) reverse[alphabet[n]] = n;

function encode(text) {
  var out = "";
  for (var i = 0; i < text.length; i += 3) {
    var a = text.charCodeAt(i);
    var b = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
    var c = i + 2 < text.length ? text.charCodeAt(i + 2) : 0;
    var word = (a << 16) | (b << 8) | c;
    out += alphabet[(word >> 18) & 63] + alphabet[(word >> 12) & 63];
    out += i + 1 < text.length ? alphabet[(word >> 6) & 63] : "=";
    out += i + 2 < text.length ? alphabet[word & 63] : "=";
  }
  return out;
}

function decode(text) {
  var codes = [];
  for (var i = 0; i < text.length; i += 4) {
    var word = (reverse[text[i]] << 18) | (reverse[text[i + 1]] << 12) | ((reverse[text[i + 2]] || 0) << 6) | (reverse[text[i + 3]] || 0);
    codes.push((word >> 16) & 255);
    if (text[i + 2] !== "=") codes.push((word >> 8) & 255);
    if (text[i + 3] !== "=") codes.push(word & 255);
  }
  return String.fromCharCode.apply(null, codes);
}

function toHex(value) {
  var digits = "0123456789abcdef";
  var out = "";
  for (var shift = 28; shift >= 0; shift -= 4) out += digits[(value >>> shift) & 15];
  return out;
}

function run(count) {
  var words = ["lorem", "ipsum dolor", "sit", "amet, consectetur", "adipiscing elit", "sed do eiusmod tempor", "x", ""];
  var total = 0;
  for (var i = 0; i < count; i++) {
    var word = words[i & 7] + (i % 100);
    var encoded = encode(word);
    if (decode(encoded) !== word) throw new Error("round trip of " + word);
    total = (total + (fnv1a(word) % 1009) + (djb2(encoded) % 1013) + toHex(i).charCodeAt(7)) % 1000000007;
  }
  return total;
}

console.log(run(250000));
