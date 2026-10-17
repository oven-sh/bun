// s.charCodeAt(i) in JavaScript without types, where s is known to be a string by a test: in operations on bits (hashes), in sums and products, compared, switched on, stored, handed on, made a
// string; inside and outside the string (NaN), with places of every kind; flat strings, ropes, 16-bit strings, parts of strings.
const lines = [];
function djb2(...values) {
    let hash = 5381;
    for (const value of values) {
        if (typeof value === "string") {
            let i = value.length;
            while (i) hash = (hash * 33) ^ value.charCodeAt(--i);
        }
    }
    return (hash >>> 0).toString(36);
}
function fnv(s) {
    if (typeof s !== "string") return -1;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
}
function pastTheEnd(s) {
    if (typeof s !== "string") return -1;
    let h = 7;
    for (let i = -2; i < s.length + 2; i++) h = (h << 5) - h + (s.charCodeAt(i) | 0) | 0;
    return h;
}
function bits(s, i) {
    if (typeof s !== "string") return "";
    const c = s.charCodeAt(i);
    return [c | 0, c & 0xff, c ^ 1, ~c, c << 2, c >> 1, c >>> 1, c >>> 0, 1 << c, -1 >>> c, (c * 65536) | 0, (c * 4294967296) ^ c].join();
}
function sums(s, i) {
    if (typeof s !== "string") return "";
    const c = s.charCodeAt(i);
    return [c + 1, c - 1, c * 2, c / 2, c % 7, -c, +c, c ** 2, c + "", `${c}`, c + c, Math.floor(c / 16), Math.max(c, 100), Math.min(c, 100), isNaN(c), Number.isInteger(c), Object.is(c, NaN), typeof c].join();
}
function compared(s, i) {
    if (typeof s !== "string") return "";
    const c = s.charCodeAt(i);
    let kind;
    switch (c) { case 97: kind = "a"; break; case 98: kind = "b"; break; case 0x4e2d: kind = "wide"; break; default: kind = "other"; }
    return [c === 97, c == 97, c !== 97, c < 98, c <= 97, c > 96, c >= 98, c === c, c == "97", c >= 48 && c <= 57, c ? "truthy" : "falsy", !c, c ?? "nil", kind].join();
}
function stored(s) {
    if (typeof s !== "string") return "";
    const list = [], object = {}, map = new Map;
    for (let i = -1; i <= s.length; i++) { const c = s.charCodeAt(i); list.push(c); object["k" + i] = c; map.set(c, i); }
    return JSON.stringify(list) + JSON.stringify(object) + [...map.keys()].join() + String.fromCharCode(...list.filter(c => c === c)) + new Uint8Array(list).join() + new Float64Array(list).join();
}
let rope = "";
for (let i = 0; i < 40; i++) rope += String.fromCharCode(97 + i % 26);
const texts = ["", "a", "ab", "hello, world", "中文 and ascii", "😀", rope, rope + rope, rope.slice(3, 20), "x".repeat(300) + "ÿ", "\0\x01\x7f\x80\xff"];
for (const t of texts) lines.push([djb2(t), djb2(t, t, "z"), fnv(t), pastTheEnd(t)].join(" "));
const places = [0, 1, -1, 2, 1.9, -0.5, NaN, Infinity, -Infinity, undefined, null, "1", "x", true, {}, [1], { valueOf() { return 1; } }, 4294967296, 4294967297, -4294967295, 1e300, 2147483648];
for (const p of places) lines.push([bits("ab中", p), sums("ab中", p), compared("ab中", p)].join(" | "));
for (const t of texts.slice(0, 6)) lines.push(stored(t));
function noArgument(s) { return typeof s === "string" ? [s.charCodeAt(), s.charCodeAt(1, 2, 3) ^ 0, s.charCodeAt(...[0])].join() : ""; }
lines.push(noArgument("ab"), noArgument(""));
function throwing(s) { if (typeof s !== "string") return; try { return s.charCodeAt({ valueOf() { throw new RangeError("mine"); } }) ^ 1; } catch (error) { return error.message; } }
lines.push(String(throwing("a")), String((() => { try { return "a".charCodeAt(Symbol.iterator) | 0; } catch (error) { return error.constructor.name; } })()), String((() => { try { return "a".charCodeAt(1n) | 0; } catch (error) { return error.constructor.name; } })()));
function ofAnything(x, i) { return x.charCodeAt(i) ^ 0; }
lines.push([ofAnything("abc", 1), ofAnything(new String("abc"), 2), ofAnything({ charCodeAt(i) { return i * 1000.5; } }, 3), ofAnything({ charCodeAt() { return "12"; } }, 0), ofAnything({ charCodeAt() { return {}; } }, 0)].join());
let total = 0;
for (let i = 0; i < 300; i++) total = (total + parseInt(djb2(rope + i, texts[i % texts.length]), 36)) % 1000003;
lines.push(String(total));
console.log(lines.join("\n"));
