var writer = Bun.stdout.writer();
setInterval(() => {
  writer.write("Wrote to stdout\n");
  writer.flush();
}, 20);
