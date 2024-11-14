//#FILE: test-http-decoded-auth.js
//#SHA1: 70ba85653c7479ce80cf528a07aa85f598f85ef8
//-----------------
"use strict";

const http = require("http");

const testCases = [
  {
    username: 'test@test"',
    password: "123456^",
    expected: "dGVzdEB0ZXN0IjoxMjM0NTZe",
  },
  {
    username: "test%40test",
    password: "123456",
    expected: "dGVzdEB0ZXN0OjEyMzQ1Ng==",
  },
  {
    username: "not%3Agood",
    password: "god",
    expected: "bm90Omdvb2Q6Z29k",
  },
  {
    username: "not%22good",
    password: "g%5Eod",
    expected: "bm90Imdvb2Q6Z15vZA==",
  },
  {
    username: "test1234::::",
    password: "mypass",
    expected: "dGVzdDEyMzQ6Ojo6Om15cGFzcw==",
  },
];

testCases.forEach((testCase, index) => {
  test(`HTTP decoded auth - case ${index + 1}`, async () => {
    const server = http.createServer((request, response) => {
      // The correct authorization header is be passed
      expect(request.headers.authorization).toBe(`Basic ${testCase.expected}`);
      response.writeHead(200, {});
      response.end("ok");
      server.close();
    });

    await new Promise(resolve => {
      server.listen(0, () => {
        // make the request
        const url = new URL(`http://${testCase.username}:${testCase.password}@localhost:${server.address().port}`);
        http.request(url).end();
        resolve();
      });
    });
  });
});

//<#END_FILE: test-http-decoded-auth.js
