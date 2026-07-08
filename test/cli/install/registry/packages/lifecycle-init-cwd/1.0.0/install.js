const fs = require("fs");
const path = require("path");

fs.writeFileSync(
  path.join(__dirname, "test.txt"),
  process.env.INIT_CWD || "does not exist"
);
