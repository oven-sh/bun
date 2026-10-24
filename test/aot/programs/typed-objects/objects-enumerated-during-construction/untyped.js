import { Derived } from "./shapes.ts";

const seen = [];
export function hook(o, storesEarly) {
  o.extra = 1;
  if (storesEarly) o.b = "early";
  let loop = "";
  for (const key in o) loop += key + ";";
  seen.push([Object.keys(o).join(), JSON.stringify({ ...o }), JSON.stringify(Object.assign({}, o)), JSON.stringify(Object.entries(o)), JSON.stringify(Object.values(o)), loop, JSON.stringify(o)].join(" | "));
}

export function run() {
  for (let i = 0; i < 12; i++) {
    const o = new Derived(i % 3 === 1);
    seen.push("made " + Object.keys(o).join() + " " + JSON.stringify(o));
  }
  for (const line of seen) console.log(line);
}
