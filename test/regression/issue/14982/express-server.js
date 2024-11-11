const express = require("express");
const app = express();

let count = 0;

app.get("/", (req, res) => {
  count++;
  if (count >= 1_000_000) {
    setTimeout(() => process.exit(0), 1);
  }

  if (count % 50_000 === 0) {
    console.log("RSS", (process.memoryUsage.rss() / 1024 / 1024) | 0, "MB");
  }
  res.send("Hello World!");
});

app.listen(3000, () => {
  console.log("Example app listening on port 3000");
});
