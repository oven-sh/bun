// from https://github.com/babel/babel/pull/13122/
expect(
  do {
    var bar = "foo";
    if (!bar) throw new Error(
      "unreachable"
    )
    bar;
  }
).toBe("foo");
expect(bar).toBe("foo");

var x = do {
  var bar = "foo";
  if (!bar) throw new Error(
    "unreachable"
  )
  bar;
};

expect(
  do {
    var bar = "foo";
    bar;
  }
).toBe("foo");
expect(bar).toBe("foo");

var x = do {
  var bar = "foo";
  bar;
};

expect(
  () => do {
    () => {
      var bar = "foo";
    };
    bar;
  }
).toThrow(ReferenceError);
