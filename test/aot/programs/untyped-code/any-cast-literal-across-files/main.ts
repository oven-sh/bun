// The literal, the interface and the JSON.parse are in three files.
import { make, type Wanted } from "./made";
import { read } from "./parsed";
const held: Wanted = make();
held.more = { n: 2 };
console.log(held.more.n, held.more.extra, JSON.stringify(held));
console.log(read('{"value":1}').value);
