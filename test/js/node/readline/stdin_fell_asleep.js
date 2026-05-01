function handleReadable() {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    console.log(JSON.stringify(chunk.toString("utf-8")));
    process.exit(0);
  }
}
process.stdin.addListener("readable", handleReadable);
process.stdin.ref();
process.stdin.unref();
await new Promise(r => setImmediate(r));
process.stdin.ref();
console.log("ready");
