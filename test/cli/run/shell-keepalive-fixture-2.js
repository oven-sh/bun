process.exitCode = 1;

(async () => {
  await Bun.$`${process.execPath} -e "console.log('hi')"`;
  process.exit(0);
})();
