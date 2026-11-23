'use strict';
const common = require('../common');
const assert = require('assert');
const url = require('url');

// https://github.com/joyent/node/issues/568
[
  [undefined, 'undefined'],
  [null, 'object'],
  [true, 'boolean'],
  [false, 'boolean'],
  [0.0, 'number'],
  [0, 'number'],
  [[], 'object'],
  [{}, 'object'],
  [() => {}, 'function'],
  [Symbol('foo'), 'symbol'],
].forEach(([val, type]) => {
  assert.throws(() => {
    url.parse(val);
  }, {
    code: 'ERR_INVALID_ARG_TYPE',
    name: 'TypeError',
    message: 'The "url" argument must be of type string.' +
             common.invalidArgTypeHelper(val)
  });
});

assert.throws(() => { url.parse('http://%E0%A4%A@fail'); },
              (e) => {
                // The error should be a URIError.
                if (!(e instanceof URIError))
                  return false;

                // The error should be from the JS engine and not from Node.js.
                // JS engine errors do not have the `code` property.
                return e.code === undefined;
              });

assert.throws(() => { url.parse('http://[127.0.0.1\x00c8763]:8000/'); },
              { code: 'ERR_INVALID_URL', input: 'http://[127.0.0.1\x00c8763]:8000/' }
);

if (common.hasIntl) {
  // An array of Unicode code points whose Unicode NFKD contains a "bad
  // character".
  const badIDNA = (() => {
    const BAD_CHARS = '#%/:?@[\\]^|';
    const out = [];
    for (let i = 0x80; i < 0x110000; i++) {
      const cp = String.fromCodePoint(i);
      for (const badChar of BAD_CHARS) {
        if (cp.normalize('NFKD').includes(badChar)) {
          out.push(cp);
        }
      }
    }
    return out;
  })();

  // The generation logic above should at a minimum produce these two
  // characters.
  assert(badIDNA.includes('℀'));
  assert(badIDNA.includes('＠'));

  for (const badCodePoint of badIDNA) {
    const badURL = `http://fail${badCodePoint}fail.com/`;
    assert.throws(() => { url.parse(badURL); },
                  (e) => e.code === 'ERR_INVALID_URL',
                  `parsing ${badURL}`);
  }

  assert.throws(() => { url.parse('http://\u00AD/bad.com/'); },
                (e) => e.code === 'ERR_INVALID_URL',
                'parsing http://\u00AD/bad.com/');
}

{
  // NOTE: bun deviates from node here. Node 25+ throws ERR_INVALID_ARG_VALUE
  // for every input (DEP0170). Bun throws for the web schemes, and for
  // scheme-less input parsed with slashesDenoteHost. Other schemes keep their
  // old result, because published packages (hosted-git-info 2.x) still parse
  // scp-style git URLs.
  const badURLs = [
    'https://evil.com:.example.com',
  ];
  const lenientURLs = [
    'git+ssh://git@github.com:npm/npm',
  ];
  badURLs.forEach((badURL) => {
    common.spawnPromisified(process.execPath, ['-e', `url.parse(${JSON.stringify(badURL)})`])
      .then(common.mustCall(({ code, stdout, stderr }) => {
        assert.strictEqual(code, 1);
      }));
  });
  lenientURLs.forEach((lenientURL) => {
    common.spawnPromisified(process.execPath, ['-e', `url.parse(${JSON.stringify(lenientURL)})`])
      .then(common.mustCall(({ code, stdout, stderr }) => {
        assert.strictEqual(code, 0);
        assert.strictEqual(stdout, '');
        assert.doesNotMatch(stderr, /DEP0170/);
      }));
  });

  common.expectWarning({
    DeprecationWarning: {
      DEP0169: '`url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.',
    },
  });
  badURLs.forEach((badURL) => {
    assert.throws(() => url.parse(badURL), {
      code: 'ERR_INVALID_ARG_VALUE',
    });
  });
  lenientURLs.forEach((lenientURL) => {
    assert.strictEqual(url.parse(lenientURL).pathname, '/:npm/npm');
  });
}
