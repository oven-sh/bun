import * as all from "./data.json";
import data from "./data.json";
console.log(data.version, Object.keys(all).join());
for (const key in all) console.log(key, JSON.stringify((all as any)[key]));
