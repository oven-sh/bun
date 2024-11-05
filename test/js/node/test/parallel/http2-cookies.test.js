//#FILE: test-http2-cookies.js
//#SHA1: 91bdbacba9eb8ebd9dddd43327aa2271dc00c271
//-----------------
'use strict';

const h2 = require('http2');

const hasCrypto = (() => {
  try {
    require('crypto');
    return true;
  } catch (err) {
    return false;
  }
})();

if (!hasCrypto) {
  test.skip('missing crypto', () => {});
} else {
  test('HTTP/2 cookies', async () => {
    const server = h2.createServer();

    const setCookie = [
      'a=b',
      'c=d; Wed, 21 Oct 2015 07:28:00 GMT; Secure; HttpOnly',
      'e=f',
    ];

    server.on('stream', (stream, headers) => {
      expect(typeof headers.abc).toBe('string');
      expect(headers.abc).toBe('1, 2, 3');
      expect(typeof headers.cookie).toBe('string');
      expect(headers.cookie).toBe('a=b; c=d; e=f');

      stream.respond({
        'content-type': 'text/html',
        ':status': 200,
        'set-cookie': setCookie
      });

      stream.end('hello world');
    });

    await new Promise(resolve => server.listen(0, resolve));

    const client = h2.connect(`http://localhost:${server.address().port}`);

    const req = client.request({
      ':path': '/',
      'abc': [1, 2, 3],
      'cookie': ['a=b', 'c=d', 'e=f'],
    });

    await new Promise((resolve, reject) => {
      req.on('response', (headers) => {
        expect(Array.isArray(headers['set-cookie'])).toBe(true);
        expect(headers['set-cookie']).toEqual(setCookie);
      });

      req.on('end', resolve);
      req.on('error', reject);
      req.end();
      req.resume();
    });

    server.close();
    client.close();
  });
}

//<#END_FILE: test-http2-cookies.js
