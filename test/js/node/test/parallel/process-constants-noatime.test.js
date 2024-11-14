//#FILE: test-process-constants-noatime.js
//#SHA1: cc1fb622e4cb1e217a3e7a0662db5050dc2562c2
//-----------------
"use strict";

const fs = require("fs");

test("O_NOATIME constant", () => {
  if (process.platform === "linux") {
    expect(fs.constants).toHaveProperty("O_NOATIME");
    expect(fs.constants.O_NOATIME).toBe(0x40000);
  } else {
    expect(fs.constants).not.toHaveProperty("O_NOATIME");
  }
});

//<#END_FILE: test-process-constants-noatime.js
