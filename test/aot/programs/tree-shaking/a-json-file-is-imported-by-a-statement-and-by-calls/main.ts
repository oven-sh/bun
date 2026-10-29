import data from "./data.json";
console.log(data.version, (await import("./data.json")).default.version, (await import("./data.json")).version);
const { default: whole, nested } = await import("./data.json");
console.log(whole.nested.port, nested.port, whole === data, whole.nested === nested);
import("./data.json").then(all => console.log(Object.keys(all).join(), all.default.version));
