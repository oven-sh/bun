import data from "./data.json";
import * as all from "./barrel";
console.log(data.version, data.nested.port);
const spoil = (it: any) => {
  it.whole.version = "9";
  it.nested.port = 81;
};
spoil(all);
console.log(data.version, data.nested.port, Object.keys(all).join());
