const face = "\u{1F600}";
const subjects = ["X" + face + "Z", face, face + face, "a" + face, face + "a", "\uD83D", "\uDE00", "\uDE00\uD83D", "x\uD83Dy\uDE00z", "plain", "caf\xe9", "\u4e2d" + face + "\u6587", ""];
const patterns = [/a?\B|q/u, /\B/u, /(?:)\B/v, /(?!\w)(?<!\w)/u, /[^\w]?\B/u, /$|\B/u, /(?<=[^])\B/u, /\B(.?)/u, /(\B)(\B)/v, /\b|\B/u, /[\uDE00]/u, /\uDE00/u, /(?=\uDE00)/u, /(?<=\uD83D)/u, /./u, /.$/u, /\B/, /a?\B|q/, /(?=\uDE00)/];
function show(match: RegExpMatchArray | RegExpExecArray | null) {
  return match ? `${JSON.stringify(match)}@${match.index}` : "null";
}
for (const pattern of patterns) {
  const line: string[] = [];
  for (const subject of subjects) line.push(`${show(pattern.exec(subject))} ${pattern.test(subject)} ${show(subject.match(pattern))} ${subject.search(pattern)} ${JSON.stringify(subject.replace(pattern, "<$&>"))} ${JSON.stringify(RegExp.lastMatch)}:${RegExp.leftContext.length}`);
  console.log(String(pattern), line.join(" | "));
}
const whole = "ab" + face + "cd" + face;
for (let from = 0; from < whole.length; from++) {
  const slice = whole.slice(from);
  console.log(from, show(/\B/u.exec(slice)), /\B/u.test(whole.slice(from)), show(whole.slice(from).match(/[^a-z]\B|\B[^a-z]/u)), show(/\B/.exec(whole.slice(from))));
}
let found = 0;
for (let turn = 0; turn < 2000; turn++) {
  if (/a?\B|q/u.test(subjects[0])) found++;
  if (/a?\B|q/u.exec(subjects[0])) found++;
  if (subjects[0].match(/a?\B|q/u)) found++;
}
console.log(found);
