const express = require("express");
const app = express();
const port = 0;
// https://github.com/oven-sh/bun/issues/11739
import json from "./package.json";
import textFile from "./text.txt";

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

      // https://github.com/oven-sh/bun/issues/11739
      if (textFile !== "hello hello\ncopyright symbols: ©\nMy UTF-16 string is 😀") {
        console.log("Expected 'hello hello\ncopyright symbols: ©\nMy UTF-16 string is 😀', got", textFile);
        process.exit(1);
      }

      // https://github.com/oven-sh/bun/issues/11739
      if (json[String.fromCharCode(169)] !== "©") {
        console.log("json has an encoding issue.", json);
        process.exit(1);
      }

      // https://github.com/oven-sh/bun/issues/11739
      if (json[String.fromCharCode(55357)] !== "😀") {
        console.log("json has an encoding issue.", json);
        process.exit(1);
      }

      console.log("OK");
      process.exit(0);
    });
  });
});
