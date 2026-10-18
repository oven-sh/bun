// A method call by name remembers at its place where the function was found. The function may be the receiver's own property outside its in-line room (an exports object, a table of handlers): the place serves that too, and goes on being right when the function is replaced, deleted, shadowed by nothing, moved by other properties coming and going, or is no function.
function table(count, from) {
  const made = {};
  for (let i = 0; i < count; i++) made["f" + (from + i)] = function (x) { return x + from + i; };
  return made;
}
function callsF40(o, x) { const got = o.f40(x); return got; }
function callsF3(o, x) { const got = o.f3(x); return got; }
const said = [];
const say = (label, run) => {
  try {
    said.push(label + " " + run());
  } catch (error) {
    said.push(label + " " + error.constructor.name);
  }
};
const wide = table(60, 0);
for (let turn = 0; turn < 20; turn++) say("own, out of line", () => callsF40(wide, turn));
wide.f40 = function (x) { return "replaced " + x; };
for (let turn = 0; turn < 3; turn++) say("replaced", () => callsF40(wide, turn));
wide.f40 = 7;
for (let turn = 0; turn < 3; turn++) say("a number", () => callsF40(wide, turn));
wide.f40 = { not: "callable" };
for (let turn = 0; turn < 3; turn++) say("an object", () => callsF40(wide, turn));
delete wide.f40;
for (let turn = 0; turn < 3; turn++) say("deleted", () => callsF40(wide, turn));
Object.setPrototypeOf(wide, { f40(x) { return "inherited " + x; } });
for (let turn = 0; turn < 3; turn++) say("inherited", () => callsF40(wide, turn));
wide.f40 = function (x) { return "own again " + x + " " + (this === wide); };
for (let turn = 0; turn < 12; turn++) say("own again", () => callsF40(wide, turn));
const others = [table(60, 0), table(50, 10), table(45, 20), table(41, 0)];
for (let turn = 0; turn < 40; turn++) say("four shapes", () => callsF40(others[turn % 4], turn));
const grows = table(41, 0);
for (let turn = 0; turn < 30; turn++) {
  say("grows", () => callsF40(grows, turn));
  grows["more" + turn] = turn;
}
for (let turn = 0; turn < 30; turn += 2) {
  delete grows["more" + turn];
  say("shrinks", () => callsF40(grows, turn));
}
const frozen = Object.freeze(table(60, 0));
for (let turn = 0; turn < 10; turn++) say("frozen", () => callsF40(frozen, turn));
const withGetter = table(60, 0);
Object.defineProperty(withGetter, "f40", { get() { return x => "through a getter " + x; }, configurable: true });
for (let turn = 0; turn < 10; turn++) say("getter", () => callsF40(turn % 2 ? withGetter : frozen, turn));
for (let turn = 0; turn < 10; turn++) say("in line and out of line", () => callsF3(turn % 2 ? table(4, 0) : frozen, turn));
for (const value of [undefined, null, 1, "text", true]) say("no object", () => callsF40(value, 1));
console.log(said.join("\n"));
