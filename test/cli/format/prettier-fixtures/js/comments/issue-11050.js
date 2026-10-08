test =
  /* @ts-ignore */
  (arg1, arg2, arg3, arg4, arg5) => (arg6, art7, arg8, arg9, arg10, arg11, arg12) => 'blah'

test =
  /* @ts-ignore */

    (arg1, arg2, arg3, arg4, arg5) =>
    (arg6, art7, arg8, arg9, arg10, arg11, arg12) =>
      "blah";

testFunction =
  // @ts-ignore ts-migrate(7031) FIXME: Binding element 'terms' implicitly has an 'any' ty... Remove this comment to see the full error message
    ({ foo1 }, { foo2 }) =>
    (foo3, foo4) => {
      return null;
    };
