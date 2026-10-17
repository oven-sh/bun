// A rope (an unflattened concatenation) is compared twice in a row, on either side of `===` (the same program without type annotations).
// ENV JSC_useDollarVM=1
const narrow = (text) => text.split("").join("");
const wide = (text) => (typeof $vm === "object" ? $vm.make16BitStringIfPossible(text) : ("\u0100" + text).substring(1));
function typed(a, b) {
  return a === b;
}
function any(a, b) {
  return a === b;
}
const out = [];
for (const compare of [typed, any]) {
  for (const make of [narrow, wide]) {
    const rope = make("message-") + make("100") + make(":row");
    const others = [make("message-100:row"), make("message-100:rox"), make("Message-100:row"), make("message-") + make("100:row"), make("message-100:ro"), rope];
    for (let round = 0;round < 3; round++)
      for (const other of others)
        out.push(compare(rope, other), compare(other, rope));
    out.push(rope, rope.length, rope.charCodeAt(9), rope.slice(3, 9), rope + "!", rope.indexOf("100"), [rope].includes(others[0]), others.indexOf(rope), new Set([rope, others[0], others[3]]).size);
    const parent = rope + make("|") + rope;
    for (let round = 0;round < 3; round++)
      out.push(compare(parent, make("message-100:row|message-100:row")), compare(make("message-100:row|message-100:rox"), parent));
    out.push(parent, parent.length);
  }
}
const list = Array.from({ length: 100 }, (_, i) => narrow("item-" + (1000 + i)));
for (let i = 0;i < 100; i += 7) {
  const rope = narrow("item-") + narrow(String(1000 + i));
  out.push(list.indexOf(rope), list.includes(rope), list.lastIndexOf(rope), list.findIndex((item) => item === rope));
}
console.log(JSON.stringify(out));
