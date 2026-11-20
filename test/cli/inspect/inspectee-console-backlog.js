const count = Number(process.env.BACKLOG_COUNT);
const size = Number(process.env.BACKLOG_SIZE);
for (let i = 0; i < count; i++) {
  console.log(`#${i} ${Buffer.alloc(size, 97 + (i % 26)).toString()}`);
}
process.once("message", () => process.exit(0));
process.send("logged");
