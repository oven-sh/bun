// Usage: bun yieldtest.js <old> <new>   Does the test of the yield fail without it?
for (const [name, exe, tune] of [["old", process.argv[2], ""], ["as is", process.argv[3], ""], ["17=0", process.argv[3], "17=0"]]) {
  const seen = Array.from({ length: 10 }, () => Bun.spawnSync([exe, "test", "test/js/web/timers/setInterval.test.js", "-t", "overruns"], { cwd: import.meta.dir + "/../../..", env: { ...process.env, BUN_TMP_TUNE: tune } }).exitCode);
  console.log(`cond yieldtest ${name}: exit codes ${seen.join(" ")}`);
}
