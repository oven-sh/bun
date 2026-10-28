console.log(
  typeof require("./data.json"),
  require("./data.json") === require("./data.json"),
  "version" in require("./data.json"),
);
