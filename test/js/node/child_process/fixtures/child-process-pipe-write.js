const fs = require("node:fs");

const stream = fs.createWriteStream(null, { fd: 3 });

stream.on("ready", () => {
  stream.write("stdout_test\n");
});
