import { Old } from "./old.js";

const Made: new () => object = Old;
console.log("keys: " + Object.keys(new Made()).join(" "));
