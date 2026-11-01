// JSON.stringify's quoting of strings against a quoting written here, character by character.
let seed = 12345;
function random(n) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; }
const hex = "0123456789abcdef";
function u(c) { return "\\u" + hex[c >> 12 & 15] + hex[c >> 8 & 15] + hex[c >> 4 & 15] + hex[c & 15]; }
function quote(s) {
  let r = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 34) r += '\\"'; else if (c === 92) r += "\\\\"; else if (c === 8) r += "\\b"; else if (c === 9) r += "\\t"; else if (c === 10) r += "\\n"; else if (c === 12) r += "\\f"; else if (c === 13) r += "\\r";
    else if (c < 32) r += u(c);
    else if (c >= 0xd800 && c <= 0xdbff) { const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0; if (d >= 0xdc00 && d <= 0xdfff) { r += s[i] + s[i + 1]; i++; } else r += u(c); }
    else if (c >= 0xdc00 && c <= 0xdfff) r += u(c);
    else r += s[i];
  }
  return r + '"';
}
const classes = [
  () => 97 + random(26), () => 97 + random(26), () => 97 + random(26), () => 32 + random(95), () => 34, () => 92, () => random(32), () => [8, 9, 10, 12, 13][random(5)], () => 0x7f, () => 0x80 + random(128),
  () => 0x100 + random(0x1000), () => 0xd800 + random(0x400), () => 0xdc00 + random(0x400), () => 0x18 + random(8), () => 0xffff, () => 0x2028 + random(2), () => 0x108 + random(6), () => 0x8008 + random(6),
];
let bad = 0, count = 0;
function check(s, how) {
  count++;
  const want = quote(s);
  const a = JSON.stringify(s);
  if (a !== want && bad++ < 10) console.log("DIFFERS alone", how, JSON.stringify([...s].map(c => c.charCodeAt(0))), a.length, want.length);
  const b = JSON.stringify({ k: s, [s]: 1, a: [s, s] });
  const wantB = '{"k":' + want + (s === "k" ? "" : "," + want + ":1") + ',"a":[' + want + "," + want + "]}";
  if (s !== "k" && s !== "a" && String(s >>> 0) !== s && b !== wantB && bad++ < 10) console.log("DIFFERS in an object", how, s.length);
  const c = JSON.stringify([s], null, 1);
  if (c !== "[\n " + want + "\n]" && bad++ < 10) console.log("DIFFERS indented", how, s.length);
  if (JSON.parse(a) !== s && bad++ < 10) console.log("DOES NOT COME BACK", how, s.length);
}
for (let mix = 0; mix < 40; mix++) {
  const narrow = mix % 2 === 0, limit = narrow ? 10 : classes.length;
  const used = []; for (let i = 0, n = 1 + random(5); i < n; i++) used.push(classes[random(limit)]);
  if (mix % 5) used.push(classes[0], classes[0], classes[0], classes[0], classes[0], classes[0]);
  for (let length = 0; length < 140; length++) {
    for (let round = 0; round < 6; round++) {
      let codes = []; for (let i = 0; i < length; i++) codes.push(used[random(used.length)]());
      const s = String.fromCharCode(...codes);
      check(s, "flat");
      if (length > 3) { check(("xy" + s + "z").slice(2, -1), "slice"); check(s.slice(0, length >> 1) + s.slice(length >> 1), "rope"); check(s.substring(1), "substring"); }
    }
  }
}
for (const length of [511, 512, 513, 1023, 1024, 1040, 4095, 4096, 4097, 16383, 16384, 16385, 70000, 300000]) {
  for (let kind = 0; kind < 8; kind++) {
    let codes = new Array(length); for (let i = 0; i < length; i++) codes[i] = kind < 4 ? (random(kind === 0 ? 1000 : kind === 1 ? 40 : kind === 2 ? 4 : 1) ? 97 + random(26) : classes[4 + random(6)]()) : (random(kind === 4 ? 1000 : kind === 5 ? 40 : kind === 6 ? 4 : 2) ? 0x3b1 + random(20) : classes[4 + random(classes.length - 4)]());
    let s = ""; for (let i = 0; i < length; i += 5000) s += String.fromCharCode(...codes.slice(i, i + 5000));
    check(s, "long " + length + " " + kind);
  }
}
console.log("checked", count, "bad", bad);
