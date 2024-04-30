const express = require("express");
const app = express();
const port = 0;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const server = app.listen(port, () => {
  fetch(`http://localhost:${server.address().port}`).then(res => {
    res.text().then(text => {
      if (text !== "Hello World!") {
        console.error("Expected 'Hello World!', got", text);
        process.exit(1);
      }
      console.log("OK");
      process.exit(0);
    });
  });
});
