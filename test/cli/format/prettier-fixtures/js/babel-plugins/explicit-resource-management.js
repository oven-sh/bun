function * g() {
  using handle = acquireFileHandle(); // block-scoped critical resource
} // cleanup

{
  using obj = g(); // block-scoped declaration
  const r = obj.next();
} // calls finally blocks in `g`

{
  await using obj = g();
}
