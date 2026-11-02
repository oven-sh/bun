// Bun.randomUUIDv5 and Bun.randomUUIDv7
console.log(
  Bun.randomUUIDv5("www.example.com", "dns"),
  Bun.randomUUIDv5("x", "6ba7b810-9dad-11d1-80b4-00c04fd430c8", "base64"),
);
const seven = Bun.randomUUIDv7("hex", 1700000000000);
console.log(seven.slice(0, 13), seven[14], seven.length, Bun.randomUUIDv7("buffer").length);
