const {
  foo,
  // bar
  // baz
}: Foo = expr;

const {
  foo1,
  // bar
  foo2,
  // baz
}: Foo = expr;

const [
  foo,
  // bar
  // baz
]: Foo = expr;

const [
  foo1,
  // bar
  foo2,
  // baz
]: Foo = expr;

function method({
  foo,
  // bar = "bar",
  // bazz = "bazz",
}: Foo) {}

function method({
  foo1,
  // bar = "bar",
  foo2
  // bazz = "bazz",
}: Foo) {}

function method([
  foo,
  // bar = "bar",
  foo2
  // bazz = "bazz",
]: Foo) {}

const {
  // bar
  // baz
}: Foo = expr;

const [
  // bar
  // baz
]: Foo = expr;
