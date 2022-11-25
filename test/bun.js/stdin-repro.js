var count = 5;
for await (let chunk of Bun.stdin.stream()) {
  const str = new Buffer(chunk).toString();
  console.error("how many?", count, chunk.byteLength);
  count -= str.split("\n").length;
  console.log(str);
}
