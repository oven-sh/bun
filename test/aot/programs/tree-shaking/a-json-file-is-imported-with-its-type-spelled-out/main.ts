import data from "./data.json" with { type: "json" };
import { version } from "./data.json" with { type: "json" };
console.log(data.version, version, (await import("./data.json", { with: { type: "json" } })).default.nested.port);
