const collect = globalThis.Bun ? full => globalThis.Bun.gc(full) : full => (full ? fullGC() : edenGC());

function makeTask(node) {
  return { replay: null, node, childIndex: 0, stack: null, count: 0, label: "task" };
}

function step(task, node, index) {
  if (task.replay !== null) return -1;
  task.node = node;
  task.childIndex = index;
  const saved = task.stack;
  task.stack = { parent: saved === null ? null : saved.parent, index };
  task.count = task.count + 1;
  task.label = "step " + index;
  return task.childIndex + task.count + task.stack.index + task.label.length;
}

function addProperty(task) {
  task.added = (task.added | 0) + 1;
}

function removeProperty(task) {
  delete task.childIndex;
}

function makeAccessor(task) {
  let hidden = 100;
  Object.defineProperty(task, "count", {
    get() {
      return hidden;
    },
    set(value) {
      hidden = value + 1000;
    },
    configurable: true,
    enumerable: true,
  });
}

function nothing() {}

function stepWithCall(task, node, index, between) {
  task.node = node;
  between(task);
  task.childIndex = index;
  task.count = task.count + 1;
  between(task);
  return [task.childIndex, task.count, task.node === node, Object.keys(task).join()].join(" ");
}

function stepThatDeletes(task, node, index) {
  task.node = node;
  delete task.stack;
  task.childIndex = index;
  task.stack = node;
  task.count = task.count + 1;
  return Object.keys(task).join() + " " + task.count;
}

function stepOnFrozen(task, node, index) {
  task.node = node;
  Object.freeze(task);
  let thrown = "nothing";
  try {
    task.childIndex = index;
  } catch (error) {
    thrown = error instanceof TypeError;
  }
  return [task.node === node, task.childIndex, task.count, thrown].join(" ");
}

function stepWithNewPrototype(task, node, parent) {
  task.node = node;
  Object.setPrototypeOf(task, parent);
  task.childIndex = task.inherited;
  return task.childIndex + " " + task.count;
}

const lines = [];
const old = makeTask(null);
collect(true);
let total = 0;
for (let round = 0; round < 300; ++round) {
  total += step(old, { round }, round);
  if (round % 100 === 50) collect(false);
  if (round % 100 === 99) collect(true);
}
lines.push(total, old.node.round, old.stack.index, old.stack.parent, old.label);

for (let round = 0; round < 6; ++round) {
  lines.push(stepWithCall(makeTask(null), { round }, round, nothing));
  lines.push(stepWithCall(makeTask(null), { round }, round, addProperty));
  lines.push(stepWithCall(makeTask(null), { round }, round, removeProperty));
  lines.push(stepWithCall(makeTask(null), { round }, round, makeAccessor));
  lines.push(stepThatDeletes(makeTask(null), { round }, round));
  lines.push(stepOnFrozen(makeTask(null), { round }, round));
  lines.push(stepWithNewPrototype(makeTask(null), { round }, { inherited: round * 2 }));
  lines.push(step({ replay: null, count: 1, label: "", stack: null, childIndex: 1, node: 0 }, [round], round));
  lines.push(step(Object.assign(Object.create({ replay: null }), { node: 1, childIndex: 2, stack: null, count: 3, label: "" }), "text", round));
}
console.log(lines.join("\n"));
