process.exitCode = Number(process.argv.at(-1));
process.on("exit", code => {
  if (code !== process.exitCode) {
    throw new Error("process.exitCode should be " + process.exitCode);
  }
  console.log("PASS");
});
