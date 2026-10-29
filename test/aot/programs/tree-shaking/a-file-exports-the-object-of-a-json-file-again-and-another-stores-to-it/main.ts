import whole, { data, v } from "./barrel";
import direct from "./data.json";
console.log(whole.version, data.version, v, direct.version);
import "./store";
export function later() {
  console.log(whole.version, data.version, v, direct.version, whole === direct);
}
later();
