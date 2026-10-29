import data from "./data.json";
import { a } from "./a";
export function b() {
  return data.version + ":" + a();
}
console.log("b", a());
