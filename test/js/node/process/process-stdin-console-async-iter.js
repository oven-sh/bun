if (!process.stdin.isTTY) throw new Error("stdin is not TTY");
let sent = false;
const writer = Bun.stdout.writer();
for await (const line of console) {
  if (!sent) {
    writer.write("RAW_MODE_SET");
    writer.flush(true);
    sent = true;
  }
  if (line === "EXIT") break;
}

writer.write("RAW_MODE_UNSET");
writer.flush(true);
writer.end();
await Bun.sleep(1000);
