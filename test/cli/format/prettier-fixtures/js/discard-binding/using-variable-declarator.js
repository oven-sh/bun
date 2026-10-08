{
  // using 1 declarator
  using void = f();
}
{
  // using 2 declarators
  using void = f(), void = g();
}
{
  // using void declarator and normal declarator
  using void = f(), x = g();
}
{
  // using declarator in for-of
  for(using void of []);
}
async () => {
  {
    // await using 1 declarator
    await using void = f();
  }
  {
    // await using 2 declarators
    await using void = f(), void = g();
  }
  {
    // await using void declarator and normal declarator
    await using void = f(), x = g();
  }
  {
    // await using declarator in for-of
    for(await using void of []);
  }
}
