// A "zero-code" app: it does not call Bun.startupSnapshot.take(); `--snapshot` (auto) takes the snapshot once startup drains.
const table = Array.from({ length: 20000 }, (_, i) => ({ i, s: "row-" + i }));
const epoch = Bun.startupSnapshot.epoch();
if (epoch > 0) {
  console.log("[js] restored epoch", epoch, "rows", table.length);
  process.exit(0);
}
process.on("restore", () => {
  console.log("[js] restored epoch", Bun.startupSnapshot.epoch(), "rows", table.length);
  process.exit(0);
});
if (!Bun.startupSnapshot.isBuildingSnapshot()) console.log("[js] plain boot rows", table.length);
