// https://github.com/typescript-eslint/typescript-eslint/pull/4382
function decorator() {}
@decorator
class Foo {
  bar(baz: typeof this) {}
}
