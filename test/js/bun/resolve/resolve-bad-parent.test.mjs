//! These tests are targetting an assertion failure, but that mistake indicates a mistake
//! in the module resolver, which is that it should not query the file system in a relative
//! manner when the referrer is not a filesystem path.

test("you can't crash the resolver with import.meta.resolve/Sync", () => {
  expect(() => {
    console.log(import.meta.resolveSync("#foo", "file:/Users/dave"));
  }).toThrow();
  expect(() => {
    console.log(import.meta.resolve("#foo", "file:/Users/dave"));
  }).toThrow();
});

// TODO(@paperdave): ensure this crash isn't possible.
test.todo("you can't crash the resolver with Bun.plugin", () => {
  //
});
