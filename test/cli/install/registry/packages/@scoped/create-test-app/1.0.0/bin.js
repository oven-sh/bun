#!/usr/bin/env node

const {writeFileSync} = require(`fs`);
const path = require(`path`);

writeFileSync(path.join(process.cwd(), `hello.txt`), `Hello World`);

console.log(`Successfully generated \`hello.txt\``);
