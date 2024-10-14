//#FILE: test-http2-byteswritten-server.js
//#SHA1: e0022b18b08bdc7ede66406fb18a0f2aedd86626
//-----------------
'use strict';

const http2 = require('http2');

let http2Server;
let serverPort;

beforeAll((done) => {
  http2Server = http2.createServer((req, res) => {
    res.socket.on('finish', () => {
      expect(req.socket.bytesWritten).toBeGreaterThan(0); // 1094
    });
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write(Buffer.from('1'.repeat(1024)));
    res.end();
  });

  http2Server.listen(0, () => {
    serverPort = http2Server.address().port;
    done();
  });
});

afterAll((done) => {
  http2Server.close(done);
});

test('HTTP/2 server bytesWritten', (done) => {
  const URL = `http://localhost:${serverPort}`;
  const http2client = http2.connect(URL, { protocol: 'http:' });
  const req = http2client.request({ ':method': 'GET', ':path': '/' });

  req.on('data', jest.fn());
  req.on('end', () => {
    http2client.close();
    done();
  });
  req.end();
});

//<#END_FILE: test-http2-byteswritten-server.js
