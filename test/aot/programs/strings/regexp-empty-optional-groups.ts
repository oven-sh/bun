// An optional group whose content matched without consuming anything is skipped: its captures stay undefined. Here the group stands where its place in the subject is known from the start of the match.
const subjects = ["", "a", "b", "ab", "ba", "a b", "aa", "\n", "a\nb", "xa", "x", "\u4e2d", "\u4e2da"];
function spoil(depth: number): number {
  const words = [depth, depth + 1, depth + 2, depth + 3, depth + 4, depth + 5, depth + 6, depth + 7];
  return depth ? spoil(depth - 1) + words[depth & 7] : words.length;
}
function row(pattern: RegExp) {
  const answers: string[] = [];
  for (const subject of subjects) {
    spoil(12);
    const match = pattern.exec(subject);
    answers.push(match ? JSON.stringify(match) + "@" + match.index : "null", JSON.stringify(subject.replace(pattern, "<$1|$2>")));
  }
  console.log(String(pattern), answers.join(" "));
}
row(/($\B)?/);
row(/($\B)?|a/);
row(/($\B)?|\s*(\2.[^a]|\1\1)+?/i);
row(/(\b)?/);
row(/(\b)?a/);
row(/(\B)?b/);
row(/(^)?a/);
row(/($)?/);
row(/($)?|b/m);
row(/x(\b)?/);
row(/x($)?/);
row(/x(\B)?a/);
row(/((?=a))?a/);
row(/((?!a))?b/);
row(/((?=a))?/);
row(/(?:(\b))?a/);
row(/(\b|$)?/);
row(/(\b|a)?/);
row(/(a|\b)?/);
row(/(a*)?b/);
row(/(a*)?$/);
row(/(a?)?b/);
row(/x(a*)?b/);
row(/(()|a)?b/);
row(/(\b)??a/);
row(/($\B)??/);
row(/^(\b)?a/);
row(/^($)?/);
row(/^x?(\b)?/);
row(/.(\b)?/s);
row(/..($)?/s);
