{
  // destructuring binding
  const [, void, ] = value;
}
{
  // for-of destructuring binding
  for (const [void] of []);
}
{
  // destructuring assignment
  [void] = [];
}
{
  // for-of destructuring assignment;
  for ([void] of []);
}
{
  // function param;
  function f([[[void], void, ], void]) {}
}
{
  // arrow function param
  ([[[void], void, ], void]) => {}
}
{
  // async arrow function param
  async ([[[void], void, ], void]) => {}
}
{
  // destructuring assignment in async call";
  async([void] = []);
}
{
  // catch param
  try {} catch ([void]) {}
}
