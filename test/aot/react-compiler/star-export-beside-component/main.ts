import { first, View } from "./barrel";
import * as barrel from "./barrel";

console.log(View({ text: first }));
console.log(barrel.View({ text: barrel.second }));
