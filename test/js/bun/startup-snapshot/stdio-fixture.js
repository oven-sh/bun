// Like color-detection libraries and UI frameworks: process.stdout is set up (and a reference kept) while modules load,
// i.e. before the snapshot is taken.
const captured = process.stdout;
const builtWithTTY = captured.isTTY === true;
Bun.startupSnapshot.main(() => {
  const now = process.stdout;
  process.stdout.write(
    `epoch=${Bun.startupSnapshot.epoch()} builtWithTTY=${builtWithTTY} nowTTY=${now.isTTY === true} colors=${Bun.enableANSIColors} sameObject=${captured === now} columns=${now.columns}\n`,
  );
});
