// Importing from "bun" reifies every lazy property of the Bun object during the build; the launch-derived ones must be this
// launch's afterwards. Captured env references are checked too: the env object keeps its identity and is refilled.
const capturedEnv = Bun.env;
const s3AtBuild = Bun.s3;
const stdoutAtBuild = Bun.stdout;
process.on("restore", () => {
  const key = /Credential=([A-Z]+)/.exec(Bun.s3.presign("k", { bucket: "b" }))?.[1];
  console.log(`[js] env=${capturedEnv.MARKER}/${Bun.env.MARKER} sameEnv=${capturedEnv === process.env} s3key=${key} sameS3=${s3AtBuild === Bun.s3} sameStdout=${stdoutAtBuild === Bun.stdout}`);
  process.exit(0);
});
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
