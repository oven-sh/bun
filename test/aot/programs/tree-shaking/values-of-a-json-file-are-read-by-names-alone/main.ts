import data, { version } from "./data.json";
console.log(
  data.version + "!",
  version.length,
  data.nested.deep.on ? "on" : "off",
  data.nested.deep.off ?? "none",
  data["nested"]["port"] + 1,
);
