// `===` between a text that lies in one piece and a text that was just put together, in every shape that putting together gives.
const part = JSON.parse('["text/html","; charset=","utf-8","W/\\"","d-","abcDEF0123456789+/","\\"","","é","日本","x"]');
const flat = text => JSON.parse(JSON.stringify(text));
const shapes = [
  () => part[0] + part[1] + part[2],
  () => (part[0] + part[1]) + part[2],
  () => part[0] + (part[1] + part[2]),
  () => `${part[3]}${part[4]}${part[5]}${part[6]}`,
  () => part[3] + part[4] + part[5] + part[6] + part[7],
  () => part[7] + part[0] + part[7],
  () => { let s = ""; for (let i = 0; i < 40; i++) s += part[10]; return s; },
  () => { let s = ""; for (let i = 0; i < 40; i++) s = part[10] + s; return s; },
  () => { let s = part[0]; for (let i = 0; i < 12; i++) s = s + part[1] + s.length; return s; },
  () => (part[0] + part[1] + part[2]).slice(3, 20) + part[2],
  () => part[5].slice(2, 9) + part[5].slice(9) + part[0].slice(1),
  () => part[0] + part[8] + part[2],
  () => part[0] + part[9] + part[2],
  () => part[9] + part[9],
  () => part[0].repeat(30) + part[1],
  () => [part[0], part[1], part[2]].join("") + part[10],
];
function same(a, b) { return a === b; }
function differs(a, b) { return a !== b; }
function remembered(holder, value) { if (holder.last !== value) { holder.last = value; return 1; } return 0; }
const out = [];
for (let round = 0; round < 8; round++) {
  out.length = 0;
  shapes.forEach((make, n) => {
    const text = flat(make());
    const changed = [0, 1, text.length >> 1, text.length - 1].map(at => flat(text.slice(0, at) + (text[at] === "~" ? "!" : "~") + text.slice(at + 1)));
    const line = [same(make(), text), same(text, make()), same(make(), make()), differs(make(), text), ...changed.map(other => same(make(), other)), ...changed.map(other => same(other, make())), same(make(), text + part[10]), same(make() + part[10], text), same(make(), flat(text.slice(1))), same(make().slice(1), flat(text.slice(1)))];
    const holder = { last: text }; const met = remembered(holder, make()) + remembered(holder, make()) + remembered(holder, changed[2]) + remembered(holder, make());
    const used = make(); const wasEqual = same(used, text);
    out.push(n + ":" + line.map(Number).join("") + met + Number(wasEqual) + used.length + used.charCodeAt(used.length - 1) + (used === text) + (used + "!" === text + "!") + new Map([[text, 1]]).has(used) + ({ [text]: 1 })[used]);
  });
}
console.log(out.join("\n"));
