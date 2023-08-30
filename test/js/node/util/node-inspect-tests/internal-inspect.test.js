// Local tests.  Some of these should go back into node.js
import assert from 'assert';
import util from 'util';

test('no assertion failures', () => {
  // Errors thrown in accessors are re-thrown //! (is this test accurate?)
  test.skip('Errors thrown in accessors are re-thrown', () => {
    const obj = new Proxy({}, {
      get() {
        throw new Error('Error message');
      },
    });

    assert.throws(() => util.format(obj), { message: 'Error message' });
  });

  assert.strictEqual(util.formatWithOptions({ numericSeparator: true }, '%d', 4000), '4_000');

  //! non-standard property, should this be kept?
  test.skip('util.stylizeWithHTML', () => {
    assert.strictEqual(util.inspect({
      'a': 1,
      'b': '<p>\xa0\u{1F4A9}</p>',
      '&lt;': NaN,
      [Symbol('<br>')]: false,
      'buf': new Uint8Array([1, 2, 3, 4]),
    }, {
      compact: false,
      stylize: util.stylizeWithHTML,
    }), '{\n' +
      '  a: <span style="color:yellow;">1</span>,\n' +
      '  b: <span style="color:green;">&apos;&lt;p&gt;&nbsp;\u{1F4A9}&lt;&#47;p&gt;&apos;</span>,\n' +
      '  <span style="color:green;">&apos;&amp;lt&#59;&apos;</span>: <span style="color:yellow;">NaN</span>,\n' +
      '  buf: Uint8Array(4) [\n' +
      '    <span style="color:yellow;">1</span>,\n' +
      '    <span style="color:yellow;">2</span>,\n' +
      '    <span style="color:yellow;">3</span>,\n' +
      '    <span style="color:yellow;">4</span>\n' +
      '  ],\n' +
      '  [<span style="color:green;">Symbol&#40;&lt;br&gt;&#41;</span>]: <span style="color:yellow;">false</span>\n' +
      '}'
    );
  });

  const a = {};
  a.b = a;
  assert.strictEqual(util.inspect(a, { compact: false }), '<ref *1> {\n  b: [Circular *1]\n}');
  assert.strictEqual(util.inspect(a, { compact: true }), '<ref *1> { b: [Circular *1] }');

  const cause = new Error('cause');
  const e2 = new Error('wrapper', { cause });
  assert.match(util.inspect(e2), /\[cause\]: Error: cause\n/);
});
