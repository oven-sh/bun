process.exitCode = 1;

(async () => {
  await Bun.$`ls .`;
  process.exit(0);
})();
