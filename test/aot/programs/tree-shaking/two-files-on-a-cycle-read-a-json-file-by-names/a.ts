import data from "./data.json";
import { b } from "./b";
export function a() {
  return data.version + data.nested.port;
}
console.log("a", b());
