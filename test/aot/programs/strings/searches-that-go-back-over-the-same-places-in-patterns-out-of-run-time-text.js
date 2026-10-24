// A pattern made at run time whose search goes back over the same places again and again answers what plain Bun answers: the same match, the same groups, and no match where plain Bun gives the match up.
const nothing = String(Date.now()).slice(99);
function show(name, source, flags, subject) {
  const match = new RegExp(source + nothing, flags).exec(subject + nothing);
  console.log(name, match === null ? "no match" : [match.index, match[0].length, ...match.slice(1).map(group => (group === undefined ? "-" : group.length))].join(" "));
}
const command = "echo foo | grep bar > baz.txt; cat qux.log; ".repeat(28);
show("five stars, none", "^.*foo.*bar.*baz.*qux.*quux.*$", "", command);
show("five stars", "^.*foo.*bar.*baz.*qux.*log.*$", "", command);
show("five stars, not anchored", ".*foo.*bar.*baz.*qux.*quux.*", "", command);
show("five stars on the second line", "^.*foo.*bar.*baz.*qux.*quux.*$", "m", command + "\n" + command + "quux\n" + command);
show("five stars from the middle of a line", ".*bar.*baz.*qux.*foo.*quux.*", "s", command + "\n" + command);
show("lazy stars", "(.*?),(.*?),(.*?),(.*?);", "", "ab,".repeat(150));
show("lazy stars that match", "(.*?),(.*?),(.*?),(.*?);", "", "ab,".repeat(150) + ";");
show("stars in optional groups", "^(?:.*/)?(?:.*/)?(?:.*/)?(?:.*/)?end$", "", "a/".repeat(120) + "x");
show("stars in optional groups that match", "^(.*/)?(.*/)?(.*/)?(.*/)?end$", "", "a/".repeat(120) + "end");
show("words", "^(?:\\w+\\s*)+;$", "", "alpha beta gamma delta eps");
show("words that match", "^(\\w+\\s*)+;$", "", "alpha beta gamma delta eps;");
show("assignments", "(?:\\w+=\\S*\\s+)*end$", "", "A=k ".repeat(600) + "no");
show("turns that may take nothing", "^(a*)*b$", "", "a".repeat(22) + "c");
show("turns that may take nothing, lazy", "^(?:a*?|b)*?c$", "", "a".repeat(20) + "d");
show("turns that may take nothing in turns that may take nothing", "^(?:(?:a*)*b?)*c$", "", "a".repeat(14) + "d");
show("counted turns", "^(?:a+){2,}b$", "", "a".repeat(22) + "c");
show("a group that is referred to", "^(a+)+\\1b$", "", "a".repeat(20) + "c");
show("a lookahead", "^(?=(a+)+b)a*", "", "a".repeat(22) + "c");
show("alternatives", "^(?:a|aa|aaa)+b$", "", "a".repeat(26) + "c");
// Plain Bun gives a match up at the hundred millionth turn that the groups of a pattern begin.
for (let count = 20; count <= 28; count++) show("a match behind " + count, "^(?:(a+)+b|a+c)$", "", "a".repeat(count) + "c");
for (let count = 30; count <= 37; count++) show("another behind " + count, "(?:a|aa)+b|c", "", "a".repeat(count) + "c");
for (let count = 24; count <= 28; count++) show("behind turns that are counted, " + count, "^(?:(?:a+){2,}b|a+c)$", "", "a".repeat(count) + "c");
for (let count = 24; count <= 28; count++) show("behind a lookahead, " + count, "^(?:(?=(a+)+b)a|a+c)$", "", "a".repeat(count) + "c");
show("two to five turns", "^(?:a+){2,5}b$", "", "a".repeat(60) + "c");
show("a lookahead that must fail", "^(?!(a+)+b)a+c$", "", "a".repeat(22) + "c");
show("behind a lookbehind", "(?<=x)(a+)+b", "", "x" + "a".repeat(22) + "c");
show("behind a lookbehind that must fail", "(?<!y|zz)(a+)+b", "", "x" + "a".repeat(22) + "c");
for (let count = 25; count <= 28; count++) show("a match behind a lookbehind, " + count, "^x(?:(?<=^x)(a+)+b|a+c)$", "", "x" + "a".repeat(count) + "c");
// These can match at the end of the subject alone, and the search begins there: no turn is taken at an earlier place.
show("only at the end, after a lookahead that must fail", "(?!(?:.|a)*c)$", "u", "α" + "a".repeat(30));
show("only at the end, behind a lookbehind", "(?<=.)(?!(?:a|a)*c)$", "u", "α" + "a".repeat(30));
show("only at the end, a class that takes pairs", "(?!(?:[^x]|a)+c)$", "u", "α" + "a".repeat(34));
show("only at the end, behind a pair", "(?<=.)(?!(?:a|a)*c)$", "u", "a".repeat(30) + "😀");
for (let count = 25; count <= 28; count++) show("up to ninety-nine turns, " + count, "(?:a|a){0,99}c|a+", "", "a".repeat(count));
for (let count = 25; count <= 28; count++) show("three to two hundred turns, as few as may be, " + count, "(?:a|a){3,200}?c|a+", "", "a".repeat(count));
for (let count = 25; count <= 28; count++) show("a group that ignores case, " + count, "(?i:a|A)*c|a+", "", "a".repeat(count));
for (let count = 25; count <= 28; count++) show("an alternative that ignores case, " + count, "(?:a|(?i:A))*(?-i:c)|a+", "i", "a".repeat(count));
show("a group where the dot takes line ends", "^(?s:.+)+(?-s:.)x$", "", "ab\n".repeat(9) + "y");
