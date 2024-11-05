//#FILE: test-http2-compat-serverresponse-end.js
//#SHA1: 672da69abcb0b86d5234556e692949ac36ef6395
//-----------------
'use strict';

const http2 = require('http2');
const { promisify } = require('util');

// Mock the common module functions
const mustCall = (fn) => jest.fn(fn);
const mustNotCall = () => jest.fn().mockImplementation(() => {
  throw new Error('This function should not have been called');
});

const {
  HTTP2_HEADER_STATUS,
  HTTP_STATUS_OK
} = http2.constants;

// Helper function to create a server and get its port
const createServerAndGetPort = async (requestListener) => {
  const server = http2.createServer(requestListener);
  await promisify(server.listen.bind(server))(0);
  const { port } = server.address();
  return { server, port };
};

// Helper function to create a client
const createClient = (port) => {
  const url = `http://localhost:${port}`;
  return http2.connect(url);
};

describe('Http2ServerResponse.end', () => {
  test('accepts chunk, encoding, cb as args and can be called multiple times', async () => {
    const { server, port } = await createServerAndGetPort((request, response) => {
      const endCallback = jest.fn(() => {
        response.end(jest.fn());
        process.nextTick(() => {
          response.end(jest.fn());
          server.close();
        });
      });

      response.end('end', 'utf8', endCallback);
      response.on('finish', () => {
        response.end(jest.fn());
      });
      response.end(jest.fn());
    });

    const client = createClient(port);
    const headers = {
      ':path': '/',
      ':method': 'GET',
      ':scheme': 'http',
      ':authority': `localhost:${port}`
    };

    let data = '';
    const request = client.request(headers);
    request.setEncoding('utf8');
    request.on('data', (chunk) => (data += chunk));
    await new Promise(resolve => {
      request.on('end', () => {
        expect(data).toBe('end');
        client.close();
        resolve();
      });
      request.end();
      request.resume();
    });
  });

  // Add more tests here...
});

// More test blocks for other scenarios...

//<#END_FILE: test-http2-compat-serverresponse-end.test.js
