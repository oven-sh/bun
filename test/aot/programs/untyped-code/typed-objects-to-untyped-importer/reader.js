import { currentRoot, isCurrent, topOf, describe, allItems, labels, each, table, labelIn } from "./state.ts";
export function rows() {
  const out = [];
  const root = currentRoot();
  out.push(["reads", root.id, root.owner.name, root.place.start, root.notes.length, root.label, root.missing]);
  out.push(["identity", root === currentRoot(), isCurrent(root), isCurrent(currentRoot())]);
  out.push(["a method of what it holds", root.owner.use(), root.owner.use(), describe()]);
  out.push(["keys", Object.keys(root).join(), JSON.stringify(root), "label" in root]);
  root.place.top = "/changed"; out.push(["a store that fits", topOf(root), describe()]);
  root.label = "named"; out.push(["an optional property is stored", describe(), Object.keys(root).join()]);
  root.notes.push("n1", "n2"); out.push(["an array it holds is pushed to", describe()]);
  root.place = { start: "/b", top: "/b/c" }; out.push(["an object of untyped code is stored", topOf(root), describe(), root.place.start]);
  const kept = root.place; kept.top = "/later"; out.push(["and stays the same object", topOf(root), root.place === kept]);
  root.place = null; out.push(["null is stored", topOf(root), describe()]);
  root.extra = { deep: [1, 2] }; out.push(["more than the type says", JSON.stringify(root.extra), Object.keys(root).join(), describe()]);
  delete root.extra; delete root.label; out.push(["deleted again", Object.keys(root).join(), describe()]);
  const list = allItems(); const mine = { id: 2, label: "two" };
  list.push(mine); out.push(["an object of untyped code is pushed", labels(), list[1] === mine, allItems().length]);
  mine.label = "two!"; out.push(["and stays the same object", labels()]);
  list[0].label = "one!"; out.push(["an element is stored to", labels(), labelIn("one")]);
  out.push(["a callback", each((item, given) => item.label + (given === root)).join()]);
  table.set("three", { id: 3, label: "three" }); out.push(["a map it is handed", labelIn("three"), table.size]);
  const copy = { ...root }; copy.id = "copy"; out.push(["a copy is its own", copy.id, root.id, copy.owner === root.owner, isCurrent(copy)]);
  return out;
}
