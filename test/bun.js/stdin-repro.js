var stdout = Bun.stdout.writer();
console.error("Started");
var count = 0;
for await (let chunk of Bun.stdin.stream()) {
  const str = new Buffer(chunk).toString();
  stdout.write(str);
  stdout.flush();
  count++;
}
console.error("Finished with", count);
