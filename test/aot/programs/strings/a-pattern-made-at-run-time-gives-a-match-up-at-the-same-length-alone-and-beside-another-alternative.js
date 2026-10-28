// Plain Bun gives a match up at the hundred millionth turn that the groups of a pattern begin, and then answers that there is none. A program can tell that from a subject that does not match:
// it asks the pattern once more with an alternative beside it that matches everywhere. That tells the two apart only as long as both patterns give up at the same length of the subject.
const nothing = String(Date.now()).slice(99);
const folders = "(?:/[^/]+)*",
  part = "[^/]*";
// q, any folders, a name with three x, any folders, a name with one x, y.
const path =
  "^q" +
  folders +
  "/" +
  part +
  "x" +
  part +
  "x" +
  part +
  "x" +
  part +
  folders +
  "/" +
  part +
  "x" +
  part +
  "/y(?=$|/$)" +
  nothing;
const forms = [path, "(?:" + path + ")|$", "(?:" + path + ")|never", path + "|$"];
for (const [flags, count] of [
  ["", 4],
  ["i", 2],
]) {
  for (const form of forms.slice(0, count)) {
    const pattern = new RegExp(form, flags);
    const answers = [];
    for (const length of [223, 224]) {
      const match = pattern.exec("q/xxx/m/" + "x".repeat(length) + "/y");
      answers.push(length + ": " + (match ? match.index + " " + match[0].length : "none"));
    }
    console.log(forms.indexOf(form), flags, answers.join(", "));
  }
}
// The turns double with each character.
for (const form of ["(?:^(x+)+$)|$", "(?:^(x+)+$)|!", "(?:^(x+)+$|never)|$"]) {
  const pattern = new RegExp(form + nothing);
  console.log(form, [26, 27].map(length => pattern.exec("x".repeat(length) + "!")?.index ?? "none").join(" "));
}
