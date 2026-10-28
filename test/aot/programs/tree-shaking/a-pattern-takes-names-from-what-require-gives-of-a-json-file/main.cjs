const {
  version,
  nested: { port },
  missing = "none",
} = require("./data.json");
console.log(version, port, missing);
