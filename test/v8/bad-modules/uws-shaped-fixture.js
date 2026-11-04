"use strict";
// The program of https://github.com/oven-sh/bun/issues/9785 with uws_shaped.node in the place of uWebSockets.js, or
// with the addon that the first argument names: uws_shaped_deflate.node deflates the response.
// It makes one request, prints the response, and ends by itself once the listening socket is closed.

const name = process.argv[2] ?? "uws_shaped";
const addon = require(require("node:path").join(__dirname, "build", "Release", `${name}.node`));

const port = addon.listen((response, url) => response.end(Array(20).fill(`Hello ${url}`).join(", ")));

fetch(`http://127.0.0.1:${port}/uWS`)
  .then(async response => {
    const { status, headers } = response;
    console.log(JSON.stringify({ status, encoding: headers.get("content-encoding"), body: await response.text() }));
  })
  .finally(() => addon.close());
