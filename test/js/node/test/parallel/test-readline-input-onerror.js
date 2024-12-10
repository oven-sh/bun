'use strict';
const common = require('../common');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

async function processLineByLine_SymbolAsyncError(filename) {
  const fileStream = fs.createReadStream(filename);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  // eslint-disable-next-line no-unused-vars
  for await (const line of rl) {
    /* check SymbolAsyncIterator `errorListener` */
  }
}

const f = path.join(__dirname, 'file.txt');

// catch-able SymbolAsyncIterator `errorListener` error
processLineByLine_SymbolAsyncError(f).catch(common.expectsError({
  code: 'ENOENT',
  message: /no such file or directory/i
}));

async function processLineByLine_InterfaceErrorEvent(filename) {
  const fileStream = fs.createReadStream(filename);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  rl.on('error', common.expectsError({
    code: 'ENOENT',
    message: /no such file or directory/i
  }));
}

// check Interface 'error' event
processLineByLine_InterfaceErrorEvent(f);
