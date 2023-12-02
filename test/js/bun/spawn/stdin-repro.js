var stdout = Bun.stdout.writer();
console.error("Started");
var count = 0;
// const file = Bun.file("/tmp/testpipe");
const file = Bun.stdin;
for await (let chunk of file.stream()) {
  const str = new Buffer(chunk).toString();
  stdout.write(str);
  await stdout.flush();
  count++;
}
console.error("Finished with", count);
