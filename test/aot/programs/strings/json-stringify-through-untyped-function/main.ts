import { catalog, page } from "./data";
import { Sender } from "./sender.js";

const rounds = Number(process.argv[2] ?? 3);
const sender = new Sender();
let last = "";
for (let round = 0; round < rounds; round++) {
  last = sender.json(catalog(42 + (round & 1))).body;
  if (round < 2) console.log(last);
  sender.json(page(round, round & 1 ? "old" : undefined), 201);
  sender.json([1, "two", null]);
  sender.json("text");
}
console.log(sender.sent, last.length, sender.json(page(7, "top"), 201));
