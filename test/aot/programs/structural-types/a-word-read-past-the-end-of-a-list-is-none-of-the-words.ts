type Word = "yes" | "no";
const words: Word[] = ["yes", "no"];

function text(word: Word): string {
  if (word === "yes") return "yes";
  if (word === "no") return "no";
  return "neither, undefined: " + (word === undefined);
}
function other(word: Word): string {
  if (word === "yes") return "yes";
  return "no: " + (word === "no");
}
function kind(word: Word): string {
  if (word === "yes" || word === "no") return "known";
  return typeof word === "string" ? "a string" : "no string";
}

console.log(text(words[0]), text(words[1]));
console.log(other(words[2]));
console.log(kind(words[2]));
console.log(text(words[2]));
