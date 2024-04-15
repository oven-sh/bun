import { sleep } from "bun";

const fs = require("node:fs");

const stream = fs.createReadStream(null, { fd: 3 });
var have_read = false;

stream.on("ready", () => {
  console.log(stream.read());
  have_read = true;
});

while (true) {
  await sleep(250);
  if (have_read) break;
}
