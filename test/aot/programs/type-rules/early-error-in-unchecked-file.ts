// Under `@ts-nocheck` the type error is not reported. The duplicate label is an ECMAScript early error and still stops the build.
// @ts-nocheck
const n: number = "x";
again: { again: { console.log(n); } }
