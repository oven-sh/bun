const common = require('../common');
const assert = require('assert');
const http = require('http');

const { once } = require('events');

const expectedHeaders = {
  'DELETE': ['host', 'connection'],
  'GET': ['host', 'connection'],
  'HEAD': ['host', 'connection'],
  'OPTIONS': ['host', 'connection'],
  'POST': ['host', 'connection', 'content-length'],
  'PUT': ['host', 'connection', 'content-length'],
  'TRACE': ['host', 'connection']
};

const expectedMethods = Object.keys(expectedHeaders);

const server = http.createServer(common.mustCall((req, res) => {
  res.end();

  assert(Object.hasOwn(expectedHeaders, req.method),
         `${req.method} was an unexpected method`);

  const requestHeaders = Object.keys(req.headers);
  for (const header of requestHeaders) {
    assert.ok(
      expectedHeaders[req.method].includes(header.toLowerCase()),
      `${header} should not exist for method ${req.method}`
    );
  }

  assert.strictEqual(
    requestHeaders.length,
    expectedHeaders[req.method].length,
    `some headers were missing for method: ${req.method}`
  );
}, expectedMethods.length));

server.listen(0, common.mustCall(() => {
  Promise.all(expectedMethods.map(async (method) => {
    const request = http.request({
      method: method,
      port: server.address().port
    }).end();
    return once(request, 'response');
  })).then(common.mustCall(() => { server.close(); }));
}));
