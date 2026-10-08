// https://babeljs.io/docs/babel-plugin-proposal-numeric-separator

let budget = 1_000_000_000_000;

// What is the value of `budget`? It's 1 trillion!
//
// Let's confirm:
console.log(budget === 10 ** 12); // true

let nibbles = 0b1010_0001_1000_0101;

// Is bit 7 on? It sure is!
// 0b1010_0001_1000_0101
//             ^
//
// We can double check:
console.log(!!(nibbles & (1 << 7))); // true

// Messages are sent as 24 bit values, but should be
// treated as 3 distinct bytes:
let message = 0xa0_b0_c0;

// What's the value of the upper most byte? It's A0, or 160.
// We can confirm that:
let a = (message >> 16) & 0xff;
console.log(a.toString(16), a); // a0, 160

// What's the value of the middle byte? It's B0, or 176.
// Let's just make sure...
let b = (message >> 8) & 0xff;
console.log(b.toString(16), b); // b0, 176

// What's the value of the lower most byte? It's C0, or 192.
// Again, let's prove that:
let c = message & 0xff;
console.log(c.toString(16), b); // c0, 192
