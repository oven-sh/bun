// Strings: `if` chains with a string of 32 characters (the same program without type annotations).
function a(s) {
  if (s === "abcdefghijklmnopqrstuvwxyz012345")
    return 0;
  if (s === "beta")
    return 1;
  if (s === "gamma")
    return 2;
  return -1;
}
function b(s) {
  switch (s) {
    case "x":
      return 0;
    case "abcdefghijklmnopqrstuvwxyz01234":
      return 1;
    case "abcdefghijklmnopqrstuvwxyz012345":
      return 2;
    case "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345":
      return 3;
    default:
      return -1;
  }
}
function c(s) {
  if (s === "abcdefghijklmnopqrstuvwxyz012345")
    return 0;
  if (s === "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")
    return 1;
  if (s === "543210zyxwvutsrqponmlkjihgfedcba")
    return 2;
  return -1;
}
function d(s) {
  if (s === "abcdefghijklmnopqrstuvwxyz01234")
    return 0;
  if (s === "iota")
    return 1;
  if (s === "zeta")
    return 2;
  return -1;
}
const ladders = [a, b, c, d];
const words = ["abcdefghijklmnopqrstuvwxyz012345", "abcdefghijklmnopqrstuvwxyz01234", "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", "543210zyxwvutsrqponmlkjihgfedcba", "beta", "gamma", "iota", "zeta", "x", "", "abcdefghijklmnopqrstuvwxyz0123456", "abcdefghijklmnopqrstuvwxyz012346"];
const wideBase = String.fromCharCode(19968);
function joined(w) {
  let p = "", q = "";
  for (let i = 0;i < w.length; i++) {
    if (i < 2)
      p += w[i];
    else
      q += w[i];
  }
  return p + q;
}
function part(w) {
  return ("<<" + w + ">>>").slice(2, 2 + w.length);
}
function partOfWide(w) {
  return (wideBase + w + wideBase).slice(1, 1 + w.length);
}
for (let f = 0;f < ladders.length; f++) {
  let line = "abcd"[f];
  for (const make of [(w) => w, joined, part, partOfWide]) {
    line += " |";
    for (const w of words)
      line += " " + ladders[f](make(w));
  }
  console.log(line);
}
