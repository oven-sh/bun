// A component file that the program reaches only by require() is paired with the compiler's output like one that is imported: a typed function that the output imports keeps the layout of its parameter's type.
import { describe, makeItem, type Item } from "./state";

const views: { View(props: { item: Item }): string } = require("./View");
let length = 0;
for (let i = 0; i < 1000; i++) length += describe(makeItem(i)).length;
console.log(length, views.View({ item: makeItem(7) }));
