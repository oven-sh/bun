{
  // destructuring binding
  const { void: void } = value;
}
{
  // for-of destructuring binding
  for (const { p: void } of []);
}
{
  // destructuring assignment
  ({ p: void } = {});
}
{
  // for-of destructuring assignment
  for ({ p: void } of []);
}
{
  // function param
  function f({ q: { q: { p: void }, p: void }, p: void }) {}
}
{
  // arrow function param
  ({ q: { q: { p: void }, p: void }, p: void }) => {}
}
{
  // async arrow function param
  async ({ q: { q: { p: void }, p: void }, p: void }) => {}
}
{
  // destructuring assignment in async call
  async({ p: void } = {});
}
{
  // catch param
  try {} catch ({ p: void }) {}
}
