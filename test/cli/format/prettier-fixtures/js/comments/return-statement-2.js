function foo() {
  return ( // Comment
    a, b
  );
  return (
    // Comment
    a, b
  );
  return /* Comment*/ (
    a, b
  );
  return (/* Comment*/
    a, b
  );
  return (
    /* Comment*/
    a, b
  );

  return ( // Comment
    a = b
  );
  return (
    // Comment
    a = b
  );

  throw (
    // Comment
    a, b
  );

  throw (
    // Comment
    a = b
  );
}

// #4032
function transitionedFromBleepToBloop() {
  return !!(
    // Start with a bloop.
    thing != null && (thing.foo && thing.foo.bar === 'bloop') &&
    // End up with a bleep.
    (thing.foo && thing.foo.bar === 'bleep')
  );

  return Boolean(
    // Start with a bloop.
    thing != null && (thing.foo && thing.foo.bar === 'bloop') &&
    // End up with a bleep.
    (thing.foo && thing.foo.bar === 'bleep')
  );

  return foo(
    // Start with a bloop.
    thing != null && (thing.foo && thing.foo.bar === 'bloop') &&
    // End up with a bleep.
    (thing.foo && thing.foo.bar === 'bleep')
  );
}
