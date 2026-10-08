{
  // function parameter
  function f(void = 0) {}
}
{
  // arrow function parameter
  (void = 0) => {}
}
{
  // async arrow function parameter
  async (void = 0) => {}
}
{
  // nested array pattern: function parameter
  function f([void = 0]) {}
}
{
  // nested array pattern: arrow function parameter
  ([void = 0]) => {}
}
{
  // nested array pattern: async arrow function parameter
  async ([void = 0]) => {}
}
{
  // nested object pattern: function parameter
  function f({ p: void = 0 }) {}
}
{
  // nested object pattern: arrow function parameter
  ({ p: void = 0 }) => {}
}
{
  // nested object pattern: async arrow function parameter
  async ({ p: void = 0 }) => {}
}

{
  // nested array pattern: destructuring binding
  let [void = 0] = [];
}
{
  // nested object pattern: destructuring binding
  let { p: void = 0 } = {};
}
{
  // nested array pattern: for-of destructuring binding
  for (let [void = 0] of []);
}
{
  // nested object pattern: for-of destructuring binding
  for (let { p: void = 0 } of [{}]);
}
{
  // nested array pattern: destructuring assignment
  ([void = 0] = []);
}
{
  // nested object pattern: destructuring assignment
  ({ p: void = 0 } = {});
}
{
  // nested array pattern: for-of destructuring assignment
  for ([void = 0] of []);
}
{
  // nested object pattern: for-of destructuring assignment
  for ({ p: void = 0 } of [{}]);
}
