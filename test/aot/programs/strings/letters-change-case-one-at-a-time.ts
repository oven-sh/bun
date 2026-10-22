const hidden = new Function("v", "return v") as <V>(v: V) => V;

function caseBlind(word: string): string {
  return [...word].map(c => (c.toLowerCase() === c ? c : `[${c}${c.toLowerCase()}]`)).join("");
}
function shout(word: string): string {
  let result = "";
  for (const c of word) result += c.toUpperCase();
  return result;
}
function firstLower(word: string): string { return word.charAt(0).toLowerCase() + word.slice(1); }
function firstUpper(word: string): string { return word[0]!.toUpperCase() + word.slice(1); }
function lowerOfPrefixed(word: string): boolean { return ("tool__" + word).toLowerCase().startsWith("tool__a"); }

const words = ["AWS_SECRET_ACCESS_KEY", "GitHubToken", "already lower", "ÉCOLE", "straße", "İstanbul", "ǅungla", "ΑΣ", "日本語", "a", "Z", "ß", "ŉ", "MiXeD123", "𝒜𝒷"];
let digest = 0;
function note(text: string): void {
  for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0;
  digest = (digest * 31 + text.length) | 0;
}
const rounds = Number(process.argv[2] ?? 20);
for (let round = 0; round < rounds; round++) {
  for (const word of words) {
    const copy = hidden(word.split("").join(""));
    note(caseBlind(copy)); note(shout(copy)); note(firstLower(copy)); note(firstUpper(copy));
    digest = (digest * 31 + (lowerOfPrefixed(copy) ? 1 : 0)) | 0;
  }
}
console.log(digest, words.map(caseBlind).join(" "), words.map(shout).join(" "), "A".toLowerCase() === "a", hidden("A").toLowerCase() === hidden("a"));
