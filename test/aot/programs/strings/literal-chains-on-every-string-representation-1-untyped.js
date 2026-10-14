// Chains of `=== "literal"` (`if .. else if`, `switch`, `||`), inside and outside loops, applied to every internal representation of every string, to near misses and to non-strings (the same program without type annotations).
// ENV JSC_useDollarVM=1
const wide = (text) => (typeof $vm === "object" ? $vm.make16BitStringIfPossible(text) : ("\u0100" + text).substring(1));
const narrow = (text) => text.split("").join("");
const makers = [
  narrow,
  wide,
  (text) => narrow(text.slice(0, 1)) + narrow(text.slice(1)),
  (text) => narrow(text.slice(0, -1)) + narrow(text.slice(-1)),
  (text) => wide(text.slice(0, 1)) + narrow(text.slice(1)),
  (text) => `${narrow(text.slice(0, 1))}${narrow(text.slice(1, 2))}${narrow(text.slice(2))}`,
  (text) => narrow("<" + text + ">").slice(1, -1),
  (text) => wide("<" + text + ">").slice(1, -1),
  (text) => {
    let all = "";
    for (const c of text)
      all += narrow(c);
    return all;
  },
  (text) => narrow("<" + text.slice(0, 2)).slice(1) + wide(text.slice(2) + ">").slice(0, -1)
];
const texts = ["running", "ok", "error", "pending", "cancelled", "text", "code", "list", "tool_use", "a_text_of_exactly_thirty_two_byte", "a_text_of_exactly_thirty_two_bytes", "a_text_of_thirty_three_characters", "runninG", "Running", "ok ", "o", "", "errors", "pendinh", "\xE9rror", "err\xF6r", "\u20ACrror", "erro\u20AC", "tool-use", "x".repeat(40)];
function bySwitch(k) {
  switch (k) {
    case "running":
      return 1;
    case "ok":
      return 2;
    case "error":
      return 3;
    case "pending":
      return 4;
    case "cancelled":
      return 5;
    default:
      return 0;
  }
}
function byIfs(k) {
  if (k === "text")
    return 1;
  else if (k === "code")
    return 2;
  else if (k === "list")
    return 3;
  else if (k === "tool_use")
    return 4;
  return 0;
}
function sameLength(k) {
  if (k === "text")
    return 1;
  if (k === "code")
    return 2;
  if (k === "list")
    return 3;
  return 0;
}
function byOr(k) {
  return k === "running" || k === "pending" || k === "ok";
}
function long(k) {
  switch (k) {
    case "a_text_of_exactly_thirty_two_byte":
      return 1;
    case "a_text_of_exactly_thirty_two_bytes":
      return 2;
    case "ok":
      return 3;
    default:
      return 0;
  }
}
function orNil(k) {
  switch (k) {
    case "running":
      return 1;
    case "error":
      return 2;
    case "ok":
      return 3;
    default:
      return 0;
  }
}
function ofAnything(k) {
  switch (k) {
    case "running":
      return 1;
    case "error":
      return 2;
    case "ok":
      return 3;
    default:
      return 0;
  }
}
function beyondLatin1(k) {
  switch (k) {
    case "\u20AC":
      return 1;
    case "ok":
      return 2;
    case "error":
      return 3;
    default:
      return 0;
  }
}
function two(a, b) {
  return bySwitch(a) * 10 + byIfs(b);
}
function twice(k, other) {
  let n = 0;
  if (k === "running")
    n = 1;
  else if (k === "error")
    n = 2;
  if (other === "text")
    n += 10;
  else if (other === "code")
    n += 20;
  if (k === "pending")
    n += 100;
  else if (k === "ok")
    n += 200;
  return n;
}
function inLoop(all) {
  let n = 0;
  for (const k of all) {
    switch (k) {
      case "running":
        n += 1;
        break;
      case "ok":
        n += 2;
        break;
      case "error":
        n += 3;
        break;
      default:
        n += 7;
    }
  }
  return n;
}
let sum = 0;
const mix = (n) => {
  sum = Math.imul(sum, 31) + n | 0;
};
const lines = [];
for (const text of texts) {
  const row = [];
  for (const make of makers) {
    if (text.length < 3) {
      if (make !== narrow && make !== wide)
        continue;
    }
    const results = [bySwitch(make(text)), byIfs(make(text)), sameLength(make(text)), byOr(make(text)) ? 1 : 0, long(make(text)), orNil(make(text)), ofAnything(make(text)), beyondLatin1(make(text)), two(make(text), make(text)), twice(make(text), make("code")), inLoop([make(text), make("ok"), make(text)])];
    for (const n of results)
      mix(n);
    row.push(results.reduce((a, b) => a * 7 + b, 0) % 100003);
  }
  lines.push(JSON.stringify(text.slice(0, 12)) + " " + (new Set(row).size === 1 ? "all alike " + row[0] : "DIFFER " + row.join(",")));
}
console.log(lines.join(`
`));
console.log(orNil(null), orNil(undefined), ofAnything(null), ofAnything(7), ofAnything({}), ofAnything(Symbol.iterator), ofAnything(new String("ok")), ofAnything(10n), beyondLatin1(wide("\u20AC")), beyondLatin1(wide("\u20AB")), sum);
