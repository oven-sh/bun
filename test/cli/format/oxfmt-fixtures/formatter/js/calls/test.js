// Test patterns with multiple levels should not break incorrectly
test.describe.serial("My test suite", () => {
  // test content
});

test.describe.serial("Import glossary from JSON", () => {
  // more test content
});

test.describe.parallel("Another test suite", () => {
  // test content
});

test.describe.serial.only("Test with only", () => {});

test.describe.parallel.only("Parallel only", () => {});

test.describe.only("Describe only", () => {});

// These simpler patterns should still work
test.only("Test only", () => {});
describe.only("Describe only", () => {});
it.only("It only", () => {});

test(code.replace((c) => ""), () => {});

expect(content)
  .toMatch(`props: /*@__PURE__*/_mergeDefaults(['foo', 'bar', 'baz'], {
})`)


// https://github.com/oxc-project/oxc/issues/16521
string().required().test('foobarbazqux', async (value, { createError }) => {
  //
})

const schema = object({
  foo: string().required().test('foobarbazqux', async (value, { createError }) => {
    //
  }),
});

global().longcalllongcall().property
  .test
  .only('foobarbazqux', async () => {
    //
  })

// https://github.com/oxc-project/oxc/issues/17272
test.fixme("C[TBD] Create automation - Priority changes triggers action @regression-standalone-qa-env @regression @automations-squad", async ({
  page: _page,
}, testInfo) => {
  // TODO
});

