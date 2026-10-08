{
  using { foo } = f();
  using [ bar ] = g();
  for (using { qux } of h());
  for (using [ quux ] of i());
}
