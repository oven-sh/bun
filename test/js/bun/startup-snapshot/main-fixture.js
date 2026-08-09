// The command-line-tool shape: everything imported at the top level ends up in the snapshot; the program runs after restore.
const table = Array.from({ length: 5000 }, (_, i) => "entry-" + i);
let mainCalls = 0;
Bun.startupSnapshot.main(() => {
  mainCalls++;
  console.log(`[js] main epoch=${Bun.startupSnapshot.epoch()} args=${JSON.stringify(process.argv.slice(2))} cwd=${require("path").basename(process.cwd())} table=${table.length} calls=${mainCalls}`);
});
if (Bun.startupSnapshot.isBuildingSnapshot()) console.log("[js] loading only; main deferred");
