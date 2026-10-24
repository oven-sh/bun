// Functions made at run time store young values into objects, arrays, closures and globals that have survived collections. Every value must still be there after the next collection.
const lines = [];
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const storeByName = new Function("target", "value", "target.held = value; return target;");
const addByName = new Function("target", "value", "target.first = value; target.second = [value]; target.third = { value }; return target;");
const storeByIndex = new Function("target", "index", "value", "target[index] = value; return target;");
const storeByKey = new Function("target", "key", "value", "target[key] = value; return target;");
const makeCounter = new Function("let held = null; return { set(value) { held = value; }, get() { return held; } };");
const storeGlobal = new Function("value", "globalThis.heldByTheGlobalObject = value;");
const storeArgument = new Function("a", "value", "arguments[0] = value; return function () { return a; };");
const young = turn => ({ turn, text: "turn " + turn, list: [turn, turn + 1] });
const show = value => JSON.stringify(value);

const oldObject = { held: null }, oldArray = [null, null, null], oldKeyed = {}, counter = makeCounter(), oldEmpties = [];
for (let i = 0; i < 8; i++) oldEmpties.push({});
collect();
collect();
for (let turn = 0; turn < 40; turn++) {
  storeByName(oldObject, young(turn));
  storeByIndex(oldArray, turn % 3, young(turn));
  storeByKey(oldKeyed, "key" + (turn % 5), young(turn));
  counter.set(young(turn));
  storeGlobal(young(turn));
  const reader = storeArgument(null, young(turn));
  if (turn % 5 === 0) addByName(oldEmpties[turn / 5], young(turn));
  for (let i = 0; i < 2000; i++) young(i);
  if (turn % 4 === 3) collect();
  lines.push([show(oldObject.held), show(oldArray), show(oldKeyed), show(counter.get()), show(globalThis.heldByTheGlobalObject), show(reader())].join(" "));
}
collect();
lines.push(show(oldEmpties));

let sum = 0;
const holders = [];
for (let i = 0; i < 300; i++) holders.push({ held: null });
collect();
for (let round = 0; round < 60; round++) {
  for (let i = 0; i < holders.length; i++) storeByName(holders[i], { round, i });
  if (round % 7 === 0) collect();
  for (let i = 0; i < holders.length; i++) sum += holders[i].held.round + holders[i].held.i;
}
lines.push("sum " + sum);
console.log(lines.join("\n"));
