class a1 extends b // comment
implements z
{
  constructor() {}
}

class a2 extends b implements z { // comment
  constructor() {}
}

class a3 extends b
implements
// comment
z,
y {
  constructor() {}
}

class a4 extends b
implements z, // comment
y {
  constructor() {}
}

class a5 extends b  implements
    z, // comment-z
    y // comment-y
    {
  constructor() {}
}

class a6 extends b  implements
// comment-z1
    z, // comment-z2
    // comment-y1
    y // comment-y2
    {
  constructor() {}
}

class a7 extends b  implements
// comment-z1
    z, // comment-z2
    // comment-y1
    y // comment-y2
         // comment-y3
    {
      //comment-body
  constructor() {}
}

class a8 extends b // comment-b
 implements
// comment-z1
    z, // comment-z2
    // comment-y1
    y // comment-y2
    {
  constructor() {}
}

class a9 extends
// comment-b1
b // comment-b2
// comment-b3
 implements
// comment-z1
    z, // comment-z2
    // comment-y1
    y // comment-y2
    {
  constructor() {}
}
