//! These tests are targetting an assertion failure, but that mistake indicates a mistake
//! in the module resolver, which is that it should not query the file system in a relative
//! manner when the referrer is not a filesystem path.

test('you can\'t crash the resolver with import.meta.resolve/Sync', () => {
  console.log(import.meta.resolveSync('#foo', 'file:/Users/dave'));
  console.log(import.meta.resolve('#foo', 'file:/Users/dave'));
});

test('you can\'t crash the resolver with Bun.plugin', () => {
// 
});
