function show(label: string, text: string): void {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  console.log(label, text.length, hash, JSON.stringify(text.slice(0, 24)), JSON.stringify(text.slice(-24)));
}

function appendSlices(s: string, count: number): string {
  let out = "";
  for (let n = 0; n < count; n++) {
    const i = n % 7;
    const j = n % 11;
    out += s.slice(i, j);
  }
  return out;
}
function appendSubstrings(s: string, count: number): string {
  let out = "";
  for (let n = 0; n < count; n++) {
    const i = n % 7;
    const j = n % 11;
    out += s.substring(j, i);
  }
  return out;
}
function appendNumbers(count: number): string {
  let out = "";
  for (let n = 0; n < count; n++) out += String(n * 37 - 1000);
  return out;
}
function appendFractions(count: number): string {
  let out = "";
  for (let n = 0; n < count; n++) out += String(n / 4);
  return out;
}

let other = "";
const noisy = {
  toString(): string {
    other += "x";
    return "<" + other.length + ">";
  },
};
function appendObjects(o: { toString(): string }, count: number): string {
  let out = "";
  for (let n = 0; n < count; n++) out += String(o);
  return out;
}
function appendBackwardSlice(s: string): string {
  let out = "[";
  out += s.slice(3, 1);
  out += "]";
  out += s.slice(1, 3);
  return out;
}
function appendOpenEndedSlice(s: string): string {
  let out = "[";
  out += s.slice(3, undefined);
  out += "]";
  out += s.substring(3, undefined);
  return out;
}
function appendSymbol(value: symbol | string): string {
  let out = "a";
  out += String(value);
  out += "b";
  return out;
}
function appendRegisteredSymbol(): string {
  let out = "a";
  out += String(Symbol.for("registered"));
  out += "b";
  return out;
}
function appendUntilThrow(o: { toString(): string }): string {
  let out = "kept";
  try {
    out += "-more";
    out += String(o);
    out += "-not reached";
  } catch (error) {
    out += "|" + (error as Error).message;
  }
  return out;
}

const latin = "abcdefghijklmnop";
const wide = "abcdefg日本語hijklm";
const rope = latin + String(latin.length) + wide.slice(0, 4);
const view = ("<<" + latin + latin + ">>").slice(2, -2);

show("slices", appendSlices(latin, 10000));
show("substrings", appendSubstrings(latin, 10000));
show("wide slices", appendSlices(wide, 10000));
show("wide substrings", appendSubstrings(wide, 10000));
show("rope slices", appendSlices(rope, 10000));
show("rope substrings", appendSubstrings(rope, 10000));
show("view slices", appendSlices(view, 10000));
show("view substrings", appendSubstrings(view, 10000));
show("numbers", appendNumbers(10000));
show("fractions", appendFractions(10000));
show("objects", appendObjects(noisy, 10000));
show("other", other);

console.log(appendBackwardSlice(latin), appendBackwardSlice(wide));
console.log(appendOpenEndedSlice(latin), appendOpenEndedSlice(wide));
console.log(appendSymbol(Symbol("s")), appendSymbol("text"), appendRegisteredSymbol());
console.log(appendUntilThrow({ toString(): string { throw new Error("no text"); } }));
console.log(appendUntilThrow({ toString(): string { return "fine"; } }));

export {};
