if (!process.stdin.isTTY) throw new Error("stdin is not TTY");
console.log("ALSO HERE!");
Bun.sleep(500);
// for await (const line of Bun.stdin.stream()) {
//   console.log(new TextDecoder().decode(line));
// }
let sent = false;
const writer = Bun.stdout.writer();
console.log(process.stdin.isRaw);

for await (const line of console) {
  console.log(line);
  if (!sent) {
    writer.write("RAW_MODE_SET\n");
    writer.flush(true);
    sent = true;
  }
  if (line === "EXIT") break;
}

// writer.write("RAW_MODE_UNSET");
// writer.flush(true);
// writer.end();
// await Bun.sleep(1000);
