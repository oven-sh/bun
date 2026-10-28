// What `exec` and `match` hand back for a group of two characters, and of none, one and three, where the text that is searched has characters beyond Latin-1: both characters ASCII, one of them, neither; Latin-1 beyond ASCII; halves of a pair. More different pairs than anybody would keep, collections in between, and what is handed back is then compared, joined, measured and used as a key.
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
let sum = 0;
const mix = text => { for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0; sum = (sum * 31 + text.length) | 0; };
const lines = [];
const kinds = {
  ascii: i => String.fromCharCode(0x20 + (i % 95)),
  digits: i => String.fromCharCode(0x30 + (i % 10)),
  latin: i => String.fromCharCode(0xa1 + (i % 94)),
  edge: i => String.fromCharCode([0x7e, 0x7f, 0x80, 0x81, 0xff, 0x100][i % 6]),
  wide: i => String.fromCharCode(0x4e00 + (i % 500)),
  halves: i => String.fromCharCode((i & 1 ? 0xdc00 : 0xd83d) + (i % 7)),
};
const counted = new Map();
const byName = {};
for (const first in kinds) {
  for (const second in kinds) {
    const before = sum;
    let equal = 0, longer = 0;
    for (let i = 0; i < 700; i++) {
      const a = kinds[first](i), b = kinds[second](i * 7 + 3);
      const text = "年" + a + b + "月" + a + "日" + a + b + a;
      const found = /年([^]{2})月([^]?)日([^]{3})()/.exec(text);
      const matched = text.match(/月([^])日([^][^])/);
      mix(found[0]); mix(found[1]); mix(found[2]); mix(found[3]); mix(found[4]); mix(matched[1]); mix(matched[2]);
      if (found[1] === a + b && found[1] === matched[2] && found[1] == text.slice(1, 3)) equal++;
      if ((found[1] + found[2]).length === 3 && found[1].charCodeAt(1) === b.charCodeAt(0) && found[1][0] === a) longer++;
      counted.set(found[1], (counted.get(found[1]) ?? 0) + 1);
      byName[matched[2]] = (byName[matched[2]] ?? 0) + found.index + matched.index;
      if (i % 233 === 0) collect();
    }
    lines.push(first + " " + second + " " + equal + " " + longer + " " + (sum - before | 0));
  }
}
lines.push("different pairs " + counted.size + " " + Object.keys(byName).length);
let total = 0;
for (const [pair, times] of counted) total = (total * 33 + times * (byName[pair] | 0) + pair.length) | 0;
lines.push("by key " + total);
// One pair again and again, behind a collection too, beside a text that is narrow.
{
  const seen = new Set();
  for (let i = 0; i < 3000; i++) {
    const wide = /(\d\d)月/.exec("2026年10月"), narrow = /(\d\d)-/.exec("2026-10-15".slice(5));
    seen.add(wide[1] + "|" + narrow[1] + "|" + (wide[1] === narrow[1]) + "|" + (wide[1] === "10") + "|" + JSON.stringify(wide) + "|" + Number(wide[1]));
    if (i === 1500) collect();
  }
  lines.push([...seen].join(" ; "));
}
// Kept across collections.
{
  const kept = [];
  for (let i = 0; i < 400; i++) { kept.push(/：(..)/.exec("時刻：" + String(10 + (i % 90)) + "分")[1]); if (i % 50 === 49) collect(); }
  collect();
  lines.push("kept " + kept.slice(0, 12).join() + " " + kept.reduce((n, piece) => n + Number(piece), 0));
}
console.log(lines.join("\n"));
console.log(sum);
