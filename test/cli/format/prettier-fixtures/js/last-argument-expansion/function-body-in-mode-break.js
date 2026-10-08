fs.readdirSync(suiteLoc).forEach(function (testName) {
  (skip ? it.skip : it)(
    testName,
    buildTest(binName, testName, opts),
    2_000_000,
  );
});

{
  (skip ? it.skip : it)(
    testName,
    buildTest(binName, testName, opts),
    2_000_000,
  );
}
