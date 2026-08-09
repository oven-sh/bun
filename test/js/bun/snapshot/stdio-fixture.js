// Like color-detection libraries: process.stdout is set up while modules load, i.e. before the snapshot is taken.
const builtWithTTY = process.stdout.isTTY === true;
Bun.startupSnapshot.main(() => {
  process.stdout.write(`epoch=${Bun.startupSnapshot.epoch()} builtWithTTY=${builtWithTTY} nowTTY=${process.stdout.isTTY === true} colors=${Bun.enableANSIColors}\n`);
});
