while (true) {
  for await (let chunk of Bun.stdin.stream()) {
    console.log(new Buffer(chunk).toString());
  }
}
