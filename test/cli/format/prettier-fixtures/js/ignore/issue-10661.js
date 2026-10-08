verylongidentifierthatwillwrap123123123123123(
  a.b
    // prettier-ignore
    // Some other comment here
    .c
);

call(
  // comment
  a.
    // prettier-ignore
    b
)

call(
  a(
/*
this won't get formatted too,
because the prettier-ignore comment is attached as MemberExpression leading comment
*/
1,
2.0000, 3
)
    // prettier-ignore
    .c
)
