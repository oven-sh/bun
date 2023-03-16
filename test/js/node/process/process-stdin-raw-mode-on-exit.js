if (!process.stdin.isTTY) throw new Error("stdin is not TTY");
process.stdin.setRawMode(true);
const writer = Bun.stdout.writer();
writer.write("RAW_MODE_SET");
writer.end();
await Bun.sleep(500);
