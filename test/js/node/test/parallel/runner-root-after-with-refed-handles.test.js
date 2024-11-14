//#FILE: test-runner-root-after-with-refed-handles.js
//#SHA1: cdfe0c601f7139167bfdc5fb5ab39ecf7b403a10
//-----------------
"use strict";

const { createServer } = require("node:http");

let server;

beforeAll(() => {
  return new Promise((resolve, reject) => {
    server = createServer();
    server.listen(0, err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
});

afterAll(() => {
  return new Promise(resolve => {
    server.close(() => {
      resolve();
    });
  });
});

test("placeholder test", () => {
  // This is a placeholder test to ensure the test suite runs
  expect(true).toBe(true);
});

//<#END_FILE: test-runner-root-after-with-refed-handles.js
