const algorithms = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"];
const data = [
  "Hello World!",
  "Hello World! Hello World! Hello World! Hello World! Hello World! Hello World! Hello World! Hello World! Hello World! Hello World!Hello World! Hello World! Hello World! Hello World! Hello World! Hello World! Hello World! Hello World! Hello World! Hello World!",
];
for (let bytes of data) {
  for (const algorithm of algorithms) {
    crypto.subtle.digest(algorithm, Buffer.from(bytes)).then(data => {
      console.log(Buffer.from(data).toString("hex"));
    });
  }
}
