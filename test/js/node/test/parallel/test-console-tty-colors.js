'use strict';
// ci sets process.env["FORCE_COLOR"], which makes the test fail in both node and bun
delete process.env["FORCE_COLOR"];

const common = require('../common');
const assert = require('assert');
const util = require('util');
const { Writable } = require('stream');
const { Console } = require('console');

function check(isTTY, colorMode, expectedColorMode, inspectOptions) {
  const items = [
    1,
    { a: 2 },
    [ 'foo' ],
    { '\\a': '\\bar' },
  ];

  let i = 0;
  const stream = new Writable({
    write: common.mustCall((chunk, enc, cb) => {
      console.log("testing case", isTTY, colorMode, expectedColorMode, inspectOptions);
      assert.strictEqual(chunk.trim(),
                         util.inspect(items[i++], {
                           colors: expectedColorMode,
                           ...inspectOptions
                         }));
      cb();
    }, items.length),
    decodeStrings: false
  });
  stream.isTTY = isTTY;

  // Set ignoreErrors to `false` here so that we see assertion failures
  // from the `write()` call happen.
  const testConsole = new Console({
    stdout: stream,
    ignoreErrors: false,
    colorMode,
    inspectOptions
  });
  for (const item of items) {
    testConsole.log(item);
  }
}

check(true, 'auto', true);
check(false, 'auto', false);
check(false, undefined, true, { colors: true, compact: false });
check(true, 'auto', true, { compact: false });
check(true, undefined, false, { colors: false });
check(true, true, true);
check(false, true, true);
check(true, false, false);
check(false, false, false);

// Check invalid options.
{
  const stream = new Writable({
    write: common.mustNotCall()
  });

  assert.throws(
    () => {
      new Console({
        stdout: stream,
        ignoreErrors: false,
        colorMode: 'true'
      });
    },
    {
      message: `The argument 'colorMode' must be one of: 'auto', true, false. Received "true"`,
      code: 'ERR_INVALID_ARG_VALUE'
    }
  );

  [0, null, {}, [], () => {}].forEach((colorMode) => {
    const received = util.inspect(colorMode);
    assert.throws(
      () => {
        new Console({
          stdout: stream,
          ignoreErrors: false,
          colorMode: colorMode
        });
      },
      {
        message: `The argument 'colorMode' must be one of: 'auto', true, false. Received ${received}`,
        code: 'ERR_INVALID_ARG_VALUE'
      }
    );
  });

  [true, false, 'auto'].forEach((colorMode) => {
    assert.throws(
      () => {
        new Console({
          stdout: stream,
          ignoreErrors: false,
          colorMode: colorMode,
          inspectOptions: {
            colors: false
          }
        });
      },
      {
        message: 'Option "options.inspectOptions.color" cannot be used in ' +
                 'combination with option "colorMode"',
        code: 'ERR_INCOMPATIBLE_OPTION_PAIR'
      }
    );
  });
}
