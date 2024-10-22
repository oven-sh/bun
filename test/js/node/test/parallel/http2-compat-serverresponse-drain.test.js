//#FILE: test-http2-compat-serverresponse-drain.js
//#SHA1: 4ec55745f622a31b4729fcb9daf9bfd707a3bdb3
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

const testString = 'tests';

test('HTTP/2 server response drain event', async () => {
  if (!hasCrypto) {
    test.skip('missing crypto');
    return;
  }

  const server = h2.createServer();

  const requestHandler = jest.fn((req, res) => {
    res.stream._writableState.highWaterMark = testString.length;
    expect(res.write(testString)).toBe(false);
    res.on('drain', jest.fn(() => res.end(testString)));
  });

  server.on('request', requestHandler);

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  const client = h2.connect(`http://localhost:${port}`);
  const request = client.request({
    ':path': '/foobar',
    ':method': 'POST',
    ':scheme': 'http',
    ':authority': `localhost:${port}`
  });
  request.resume();
  request.end();

  let data = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => (data += chunk));

  await new Promise(resolve => request.on('end', resolve));
  
  expect(data).toBe(testString.repeat(2));
  expect(requestHandler).toHaveBeenCalled();
  
  client.close();
  await new Promise(resolve => server.close(resolve));
});

//<#END_FILE: test-http2-compat-serverresponse-drain.js
