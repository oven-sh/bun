import { Options } from "./shapes.ts";

function listings(o) {
  const inLoop = [];
  for (const key in o) inLoop.push(key);
  return [Object.keys(o).join(), inLoop.join(), Object.keys(JSON.parse(JSON.stringify(o))).join(), Object.keys({ ...o }).join(), Object.entries(o).map(entry => entry[0]).join(), Reflect.ownKeys(o).map(String).join()];
}

export function run() {
  let wrong = 0;
  let firstWrong = "";
  const mark = Symbol("mark");
  for (let i = 0; i < 140000; i++) {
    const o = new Options();
    o["name" + i] = i;
    if (i % 1000 === 1) o[mark] = i;
    if (i % 1000 === 2) o[i] = i;
    o.fill(i);
    const expected = (i % 1000 === 2 ? i + "," : "") + "always,name" + i + ",host,port";
    const all = i % 1000 < 3 ? listings(o) : [Object.keys(o).join()];
    if (i % 1000 === 1) all[5] = all[5].replace(",Symbol(mark)", "");
    for (const keys of all) {
      if (keys !== expected) {
        if (!wrong) firstWrong = i + ": " + keys;
        wrong++;
      }
    }
  }
  console.log("keys out of order:", wrong, firstWrong);
  const last = new Options();
  last.fill(1);
  last.tag = 1;
  console.log(listings(last).join(" | "));
  const backwards = new Options();
  backwards.port = 1;
  backwards.tag = 1;
  backwards.host = "h";
  console.log(listings(backwards).join(" | "));
}
