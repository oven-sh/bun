// A string grows around a loop, and an earlier value of it is still wanted after an append.
function checksum(text: string): string {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return text.length + ":" + sum + ":" + text.slice(0, 16) + ".." + text.slice(-16);
}
function restores(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    const before = text;
    text += "a";
    text += i;
    text += "b";
    text += i;
    text += "c";
    if (i % 7 === 0) text = before;
  }
  return text;
}
function keepsTheLast(turns: number): string {
  let text = "",
    last = "";
  for (let i = 0; i < turns; i++) {
    last = text;
    text += "a";
    text += i;
    text += "b";
    text += i;
    text += "c";
  }
  return text + "|" + last;
}
function picksOneOfTwo(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    const longer = text + "n" + i + ";";
    text = i % 3 === 0 ? text + "T" : longer;
  }
  return text;
}
function swaps(turns: number): string {
  let first = "",
    second = "";
  for (let i = 0; i < turns; i++) {
    first += "n" + i + ";";
    const held = first;
    first = second;
    second = held;
  }
  return first + "|" + second;
}
function wraps(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) text = "<" + text + i + ">";
  return text;
}
function comesBackAsAPiece(turns: number): string {
  let text = "",
    held = "";
  for (let i = 0; i < turns; i++) {
    held = text;
    text = "<";
    text += i;
    text += ">";
    text += i;
    text += held;
  }
  return text;
}
function startsOverWithALongString(long: string, turns: number): string {
  let text = "",
    lengths = 0;
  for (let i = 0; i < turns; i++) {
    if (i % 2 === 0) {
      lengths += text.length;
      text = long;
    } else text += "n" + i + ";";
  }
  return text + lengths;
}
for (const form of [restores, keepsTheLast, picksOneOfTwo, swaps, wraps, comesBackAsAPiece])
  for (const turns of [0, 1, 4, 40, 3000]) console.log(form.name, turns, checksum(form(turns)));
for (const length of [0, 100, 5000, 70000])
  console.log("startsOverWithALongString", length, checksum(startsOverWithALongString("x".repeat(length), 101)));
