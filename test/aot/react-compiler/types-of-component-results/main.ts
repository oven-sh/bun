// A component file holds objects of typed files in what it makes: in the properties of its elements, in its literals, in what it hands to typed functions. The types of what is held stay what the typed files say.
import { View } from "./View";
import { currentRoot, describe, items, keptChoice, topOf } from "./state";

let sum = 0;
for (let i = 0; i < 1000; i++) sum += currentRoot().id.length + currentRoot().owner.use() + (topOf(currentRoot()) ?? "").length;
console.log(sum, describe(currentRoot()));
console.log(View({ title: "held" }));
console.log(describe(currentRoot()), JSON.stringify(items), keptChoice()!.root === currentRoot(), keptChoice()!.item === items[1], keptChoice()!.note);
