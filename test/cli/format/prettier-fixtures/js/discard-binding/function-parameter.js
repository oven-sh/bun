{
  // function parameter
  function f(void) {}
}
{
  // arrow function parameter
  (x, void) => {}
}
{
  // async arrow function parameter
  async (void, x) => {}
}
{
  // object method parameter
  ({ f(x, void, y) {} });
}
{
  // class method parameter
  class C { m(void,) {} }
}
