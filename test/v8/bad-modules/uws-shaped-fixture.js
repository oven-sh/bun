"use strict";
// The program of https://github.com/oven-sh/bun/issues/9785 with uws_shaped.node in the place of uWebSockets.js.
// It makes one request, prints the response, and ends by itself once the listening socket is closed.

const addon = require(require("node:path").join(__dirname, "build", "Release", "uws_shaped.node"));

const port = addon.listen((response, url) => response.end(Array(20).fill(`Hello ${url}`).join(", ")));

fetch(`http://127.0.0.1:${port}/uWS`)
  .then(async response => {
    const { status, headers } = response;
    console.log(JSON.stringify({ status, encoding: headers.get("content-encoding"), body: await response.text() }));
  })
  .finally(() => addon.close());
