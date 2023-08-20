import fsevents from "fsevents";

if (process.argv.length < 3) {
  console.log("Usage: bun fsevents-event-loop.ts <directory>");
  process.exit(1);
}
fsevents.watch(process.argv[2], () => {
  console.log("it works!");
  process.exit(0);
});
