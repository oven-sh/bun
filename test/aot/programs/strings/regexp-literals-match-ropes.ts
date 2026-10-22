// A RegExp literal that is matched where it stands meets subjects that are ropes: pieces cut out of a longer text and texts that were just put together, narrow and wide.
// test, exec, search and match answer what plain Bun answers, and lastIndex moves as it does there.
const narrow: string = JSON.parse('"xxabbbc-abc-zzabbcabcabbbbc--the quick brown fox, 12 + 345 = 357; done"');
const wide: string = JSON.parse('"\\u4e2d\\u6587 abbbc \\u03c0 12\\u5186 abc \\u7d42 345 \\u4e2dabbc"');
const parts: string[] = JSON.parse('["abb", "bbc", "c-a", "zzz", "", "1", "23 ", "\\u4e2d", "\\u03c0ab", "bc\\u5186"]');

function show(match: RegExpMatchArray | RegExpExecArray | null): string {
  return match ? `${JSON.stringify(match)}@${match.index}/${match.input!.length}` : "null";
}
function ask(s: string): string {
  const all = /ab+/g;
  const found: string[] = [];
  while (all.test(s) && found.length < 9) found.push(String(all.lastIndex));
  const sticky = /a|b/y;
  let steps = 0;
  while (sticky.test(s)) steps++;
  const walked: string[] = [];
  const walker = /(\d)(\d*)/g;
  for (let m = walker.exec(s); m !== null && walked.length < 9; m = walker.exec(s)) walked.push(`${m[1]}|${m[2]}@${m.index}:${walker.lastIndex}`);
  return [
    /^ab+c/.test(s), /b+c$/.test(s), /\d+\s/.test(s), /[一-仿]/.test(s), /^$/.test(s), /π/u.test(s), /ABB/i.test(s),
    s.search(/b+c/), s.search(/\d/), s.search(/[^\x00-\xff]/), s.search(/q(?=u)/),
    show(/(a)(b+)c/.exec(s)), show(/(?<number>\d+)/.exec(s)), show(/(z)?(\d)/.exec(s)), show(/nothing like it/.exec(s)),
    show(s.match(/(a)(b+)c/)), show(s.match(/\s(\S)/)), JSON.stringify(s.match(/b+/g)), JSON.stringify(s.match(/[^\x00-\x7f]/g)),
    found.join(), all.lastIndex, steps, sticky.lastIndex, walked.join(),
  ].join(" ");
}

const lines: string[] = [];
for (const text of [narrow, wide]) {
  for (let from = 0; from < text.length; from += 3) {
    for (const length of [0, 1, 2, 3, 7, 12, 40]) {
      lines.push(`${from}+${length} ${ask(text.substring(from, from + length))}`);
      lines.push(`${from}~${length} ${ask(text.slice(from, from + length + 2).slice(1))}`);
    }
  }
}
for (const first of parts) {
  for (const second of parts) {
    lines.push(`${JSON.stringify(first)} ${JSON.stringify(second)} ${ask(first + second)}`);
    lines.push(`three ${ask(first + second + first)}`);
    lines.push(`piece of both ${ask((first + narrow.substring(2, 9) + second).substring(1))}`);
  }
}
function nested(depth: number, part: string): string {
  return depth ? nested(depth - 1, part) + part + depth : part;
}
lines.push(ask(nested(12, "ab")), ask(nested(30, "中abc")), ask(nested(5, "abbc").slice(2) + nested(3, "12").slice(1, 5)));
console.log(lines.join("\n"));

// The same rope again and again: it is flattened once, and stays what it was.
const kept = parts[0] + parts[1] + parts[2];
let hits = 0;
for (let turn = 0; turn < 2000; turn++) {
  if (/^ab+c/.test(kept)) hits++;
  if (/^ab+c/.test(narrow.substring(2 + (turn & 1), 12))) hits += 10;
  if (narrow.substring(turn & 7, 30).search(/z+a/) >= 0) hits += 100;
  if (/(z+)(a)/.exec(narrow.substring(turn & 15, 20)) !== null) hits += 1000;
}
console.log(hits, kept, kept.length);
