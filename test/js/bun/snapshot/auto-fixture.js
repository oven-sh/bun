// A "zero-code" app: it does not call Bun.unsafe.snapshot(); `--snapshot` (auto) takes the snapshot once startup drains.
const table = Array.from({ length: 20000 }, (_, i) => ({ i, s: "row-" + i }));
const state = Bun.unsafe.snapshotState();
if (state.epoch > 0) {
  console.log("[js] restored epoch", state.epoch, "rows", table.length);
  process.exit(0);
}
process.on("restore", () => {
  console.log("[js] restored epoch", Bun.unsafe.snapshotState().epoch, "rows", table.length);
  process.exit(0);
});
if (!state.building) console.log("[js] plain boot rows", table.length);
