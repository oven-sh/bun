'use strict';
const common = require('../common');
const { addresses } = require('../common/internet');
const assert = require('assert');
const http = require('http');
const dc = require('diagnostics_channel');

const isIncomingMessage = (object) => object instanceof http.IncomingMessage;
const isOutgoingMessage = (object) => object instanceof http.OutgoingMessage;
const isError = (error) => error instanceof Error;

dc.subscribe('http.client.request.created', common.mustCall(({ request }) => {
  assert.strictEqual(isOutgoingMessage(request), true);
}, 2));

dc.subscribe('http.client.request.start', common.mustCall(({ request }) => {
  assert.strictEqual(isOutgoingMessage(request), true);
}, 2));

dc.subscribe('http.client.request.error', common.mustCall(({ request, error }) => {
  assert.strictEqual(isOutgoingMessage(request), true);
  assert.strictEqual(isError(error), true);
}));

dc.subscribe('http.client.response.finish', common.mustCall(({
  request,
  response
}) => {
  assert.strictEqual(isOutgoingMessage(request), true);
  assert.strictEqual(isIncomingMessage(response), true);
}));

const server = http.createServer(common.mustCall((req, res) => {
  res.end('done');
}));

server.listen(async () => {
  const { port } = server.address();

  // Test error event with invalid host
  const invalidRequest = http.get({
    host: addresses.INVALID_HOST,
  });
  await new Promise((resolve) => {
    invalidRequest.on('error', resolve);
  });

  // Test successful request
  http.get(`http://localhost:${port}`, (res) => {
    res.resume();
    res.on('end', () => {
      server.close();
    });
  });
});
