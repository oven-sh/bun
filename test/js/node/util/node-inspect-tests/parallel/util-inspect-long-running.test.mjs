import util from 'util';
// Test that huge objects don't crash due to exceeding the maximum heap size.

// Create a difficult to stringify object. Without the artificial limitation
// this would crash or throw an maximum string size error.

test.skip('should not hang', () => {
  let last = {};
  const obj = last;

  for (let i = 0; i < 1000; i++) {
    last.next = { circular: obj, last, obj: { a: i, b: 2, c: true } };
    last = last.next;
    obj[i] = last;
  }

  //console.log(
  //  util.inspect(obj, { depth: Infinity })
  //);
});
