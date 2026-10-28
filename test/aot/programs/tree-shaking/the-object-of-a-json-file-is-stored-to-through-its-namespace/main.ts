import * as all from "./data.json";
import data from "./data.json";
(all.default as any).version = "9";
const handed = (it: any) => {
  it.default.nested.port = 81;
};
handed(all);
console.log(data.version, data.nested.port);
