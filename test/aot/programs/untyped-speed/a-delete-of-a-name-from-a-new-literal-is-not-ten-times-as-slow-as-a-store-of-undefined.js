// `delete message.draft` on an object that the function has just made, against `message.draft = undefined` on the same literal: the first has more to do, but not ten times as much.
const kept = new Array(8);
function deletes(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const message = { id: i, draft: true, text: "hi" };
    delete message.draft;
    kept[i & 7] = message;
    sum += message.text.length + ("draft" in message ? 1 : 0);
  }
  return sum;
}
function stores(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const message = { id: i, draft: true, text: "hi" };
    message.draft = undefined;
    kept[i & 7] = message;
    sum += message.text.length + (message.draft !== undefined ? 1 : 0);
  }
  return sum;
}
function fastestOf(runs, run) {
  let fastest = Infinity;
  for (let k = 0; k < runs; k++) {
    const began = performance.now();
    if (run(1_000_000) !== 2_000_000) console.log("a wrong sum");
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
fastestOf(2, deletes), fastestOf(2, stores);
console.log(fastestOf(5, deletes) < fastestOf(5, stores) * 10 ? "under ten times the time" : "over ten times the time");
