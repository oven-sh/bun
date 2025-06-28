process.exitCode = 1;

(async () => {
  console.log("here 1");
  await Bun.$`ls .`;
  console.log("here 2");
  process.exit(0);
})();
