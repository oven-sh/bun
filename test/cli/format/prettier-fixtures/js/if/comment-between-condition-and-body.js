if (1) { // 11
  doThing(foo);
}
if (1){}else { // 12
  doThing(foo);
}

if (2)
// 21
{
  doThing(foo);
}
if (2){}else
// 22
{
  doThing(foo);
}

if (3)// 31
{
  doThing(foo);
}
if (3){}else// 32
{
  doThing(foo);
}

if (4)/* 41 */{
  doThing(foo);
}
if (4){}else/* 42 */{
  doThing(foo);
}
