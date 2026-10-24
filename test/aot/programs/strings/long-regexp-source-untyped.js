// The `source` property of very long regular expressions, with slashes and escapes (the same program without type annotations).
function sum(s) {
  let h = 0;
  for (let i = 0;i < s.length; i++)
    h = h * 31 + s.charCodeAt(i) | 0;
  return h;
}
function fill(n, head) {
  return head + "|[" + "a".repeat(n - head.length - 7) + "]{9}~";
}
const heads = [["plain", "xy+z"], ["escaped slash", "x\\/y"], ["slash in brackets", "x[/]y"], ["bare slash", "x/y"], ["bare slash behind an escaped one", "x\\/y/z"], ["bracket closed, then a slash", "[a]/b"], ["escaped bracket, then a slash", "\\[/\\]"], ["line feed", `x
y`], ["carriage return", "x\ry"], ["escaped line feed", "x\\\ny"], ["u2028", "x" + String.fromCharCode(8232) + "y"], ["16 bits", "x" + String.fromCharCode(19968) + "y"], ["16 bits and a slash", "x" + String.fromCharCode(19968) + "/y"], ["backslash at the end of the head", "x\\\\"]];
const lengths = [64, 4095, 4096, 4097, 5000, 16384, 16385, 65535, 65536, 65537, 70000];
let rows = 0;
for (const [name, head] of heads) {
  let line = name + ":";
  for (const n of lengths) {
    for (const flags of ["", "giu"]) {
      let r;
      try {
        r = new RegExp(fill(n, head), flags);
      } catch (e) {
        line += " " + n + flags + ":" + e.name;
        rows++;
        continue;
      }
      const s = r.source, again = r.source, t = r.toString(), copy = new RegExp(r), text = String(r);
      line += " " + n + flags + ":" + s.length + "," + sum(s) + "," + (s === again) + "," + t.length + "," + sum(t) + "," + (copy.source === s) + "," + (text === t) + "," + JSON.stringify(s.slice(0, 12)) + "," + r.test("xy") + r.test("aaaaaaaaa~");
      rows++;
    }
  }
  console.log(line);
}
const a = new RegExp(fill(5000, "one"));
const b = new RegExp(fill(6000, "two\\/"));
const joined = new RegExp(a.source + "|" + b.source, "g");
console.log(joined.source.length, sum(joined.source), joined.source === a.source + "|" + b.source, new RegExp("").source, new RegExp("/").source, /a\/b/.source, /[/]/.source);
console.log(rows + " rows");
