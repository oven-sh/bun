promise.then(
  (result) => result,
  (err) => err
)

promise.then(
  (result) => { f(); return result },
  (err) => { f(); return err }
)

foo(a => b)
foo(a => { return b })
foo(c, a => b)
foo(c, a => b, d)
foo(a => b, d)

foo(a => (0, 1));
foo(a => b => (0, 1));

() => ({} ? 1 : 2);
() => () => ({} ? 1 : 2);
