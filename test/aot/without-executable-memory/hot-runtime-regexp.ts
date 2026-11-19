const codes = [40, 97, 43, 98, 124, 99, 41, 42, 100, 91, 48, 45, 57, 93, 123, 50, 44, 125, 120, 63];
const pattern = new RegExp(String.fromCharCode(...codes.map(code => code + (Date.now() < 0 ? 1 : 0))), "g");
let text = "";
for (let i = 0; i < 20000; i++) text += "aabcaaabd" + (10 + (i % 89)) + (i % 3 ? "x" : "") + " ";
let found = 0, length = 0;
for (let round = 0; round < 20; round++) {
  for (const match of text.matchAll(pattern)) { found++; length += match[0].length; }
}
console.log(pattern.source, found, length);
