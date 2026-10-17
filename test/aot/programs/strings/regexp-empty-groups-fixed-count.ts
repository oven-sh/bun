const patterns = [/^(a|){3}b/, /^((a)|){3}b/, /^(?:a|){3}b/, /^(|a){3}b/, /(a|){2}/, /(a|b|){4}c/, /^(?:(a)|(b)|){3}$/, /^(a?){3}b/, /^(a*){2}b/, /^(?:a??){3}a/, /(\b){3}x/, /(?:){5}y/, /^(?:(?=a)|b){3}a/, /^((a|){2}){2}b/, /^(a|){3}\1b/, /^(?:x(a|){2}y){2}$/, /^(a|){2,4}b/, /^(a|){3,}b/, /(?:[0-9a-f]{1,4}:(?::|\b)|){5}z/, /^(?<n>a|){3}b/, /(a|){3}$/, /^(?:a|){3}?b/, /^(ab|a|){3}b/, /^(a|){3}(b|){2}c/];
const subjects = ["", "b", "ab", "aab", "aaab", "aaaab", "abc", "c", "abac", "bbbc", "aba", "ab b", "x", " x", "y", "aa", "aaa", "aaaa", "xy", "xayxaay", "xaayxy", "xaaay", "1:2:3:z", "1::2:z", "ff:ff:ff:ff:ff:z", "ff:ff:ff:ff:ff:ff:z", "z", "abab", "ababb", "abbc", "aabbc", "aaabbc", "\u4e2daab", "aab\u4e2d"];
for (const pattern of patterns) {
  const line: string[] = [];
  for (const subject of subjects) {
    const match = pattern.exec(subject);
    line.push(match ? `${JSON.stringify(match)}@${match.index}` : "-");
    if (pattern.test(subject) !== !!match) line.push("TEST DISAGREES");
  }
  console.log(String(pattern), line.join(" "));
}
console.log("aaab aab b".replace(/(a|){3}b/g, "[$1]"), "aab".split(/(a|){2}/).join("|"), [..."aabab".matchAll(/(a|){2}b/g)].map(match => match.index + ":" + match[1]).join());
