!x;
!(x /* foo */);
!(/* foo */ x);
!(
  /* foo */
  x
);
!(
  x
  /* foo */
);
!(
  x // foo
);

!(x + y);
!(x + y /* foo */);
!(/* foo */ x + y);
!(
  /* foo */
  x + y
);
!(
  x + y
  /* foo */
);
!(
  x + y // foo
);

!(x || y);
!(/* foo */ x || y);
!(x || y /* foo */);
!(
  /* foo */
  x || y
);
!(
  x || y
  /* foo */
);
!(
  x || y // foo
);

![1, 2, 3];
!([1, 2, 3] /* foo */);
!(/* foo */ [1, 2, 3]);
!(
  /* foo */
  [1, 2, 3]
);
!(
  [1, 2, 3]
  /* foo */
);
!(
  [1, 2, 3] // foo
);

!{ a: 1, b: 2 };
!({ a: 1, b: 2 } /* foo */);
!(/* foo */ { a: 1, b: 2 });
!(
  /* foo */
  { a: 1, b: 2 }
);
!(
  { a: 1, b: 2 }
  /* foo */
);
!(
  { a: 1, b: 2 } // foo
)

!function() {
  return x;
};
!(
  function() {
    return x;
  } /* foo */
);
!(
  /* foo */ function() {
    return x;
  }
);
!(
  /* foo */
  function() {
    return x;
  }
);
!(
  function() {
    return x;
  }
  /* foo */
);
!(
  function() {
    return x;
  } // foo
)

!+3;
!(+3 /* foo */);
!(/* foo */ +3);
!(
  /* foo */
  +3
);
!(
  +3
  /* foo */
);
!(
  +3 // foo
);

!+(
  /* foo */
  3
);
!(/* foo */ +(3 /* foo */));
!(+(3 /* foo */) /* foo */);
!(
  /* foo */
  +(
    /* foo */
    3
  )
);
!(
  +(
    3
    /* foo */
  )
  /* foo */
);
!(
  +(
    3 /* foo */
  ) // foo
);

!(x = y);
!(x = y /* foo */);
!(/* foo */ x = y);
!(
  /* foo */
  x = y
);
!(
  x = y
  /* foo */
);
!(
  x = y // foo
);

!x.y;
!(x.y /* foo */);
!(/* foo */ x.y);
!(
  /* foo */
  x.y
);
!(
  x.y
  /* foo */
);
!(
  x.y // foo
);

!(x ? y : z);
!(x ? y : z /* foo */);
!(/* foo */ x ? y : z);
!(
  /* foo */
  x ? y : z
);
!(
  x ? y : z
  /* foo */
);
!(
  x ? y : z // foo
);

!x();
!(x() /* foo */);
!(/* foo */ x());
!(
  /* foo */
  x()
);
!(
  x()
  /* foo */
);
!(
  x() // foo
);

!new x();
!(new x() /* foo */);
!(/* foo */ new x());
!(
  /* foo */
  new x()
);
!(
  new x()
  /* foo */
);
!(
  new x() // foo
);

!(x, y);
!(x, y /* foo */);
!(/* foo */ x, y);
!(
  /* foo */
  x, y
);
!(
  x, y
  /* foo */
);
!(
  x.y // foo
);

!(() => 3);
!(() => 3 /* foo */);
!(/* foo */ () => 3);
!(
  /* foo */
  () => 3
);
!(
  () => 3
  /* foo */
);
!(
  () => 3 // foo
);

function* bar() {
  !(yield x);
  !(yield x /* foo */);
  !(/* foo */ yield x);
  !(
    /* foo */
    yield x
  );
  !(
    yield x
    /* foo */
  );
  !(
    yield x // foo
  );
}

async function bar2() {
  !(await x);
  !(await x /* foo */);
  !(/* foo */ await x);
  !(
  /* foo */
  await x
  );
  !(
    await x
    /* foo */
  );
  !(
    await x // foo
  );
}
