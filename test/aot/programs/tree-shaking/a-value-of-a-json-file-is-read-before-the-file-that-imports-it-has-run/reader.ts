import "./caller";
import data from "./data.json";
export function early() {
  return data.version;
}
console.log(early());
