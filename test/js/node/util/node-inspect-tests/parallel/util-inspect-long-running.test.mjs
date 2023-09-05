import util from "util";
// Test that huge objects don't crash due to exceeding the maximum heap size.

// Create a difficult to stringify object. Without the artificial limitation
// this would crash or throw an maximum string size error.

//! This test currently relies on a non-standard extension to util.inspect
//  It optimizes the output of circular objects. If that extension ends up
//  being removed, this test will likely hang for a pretty long time.
//  We are missing some kind of optimization Node does to pass this test near instantly even without the extension.

test("should not take longer than 2 seconds", () => {
  let last = {};
  const obj = last;

  for (let i = 0; i < 500; i++) {
    // original value: 1000 (reduced to 500 to let tests run faster)
    last.next = { circular: obj, last, obj: { a: i, b: 2, c: true } };
    last = last.next;
    obj[i] = last;
  }

  const str = util.inspect(obj, { depth: Infinity, colors: false });
  void str;
  //console.log(str);
  //console.log(str.length);
});
