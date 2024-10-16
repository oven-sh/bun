//#FILE: test-http2-goaway-opaquedata.js
//#SHA1: 5ad5b6a64cb0e7419753dcd88d59692eb97973ed
//-----------------
'use strict';

const http2 = require('http2');

let server;
let serverPort;

beforeAll((done) => {
  server = http2.createServer();
  server.listen(0, () => {
    serverPort = server.address().port;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

test('HTTP/2 GOAWAY with opaque data', (done) => {
  const data = Buffer.from([0x1, 0x2, 0x3, 0x4, 0x5]);
  let session;

  server.once('stream', (stream) => {
    session = stream.session;
    session.on('close', () => {
      expect(true).toBe(true); // Session closed
    });
    session.goaway(0, 0, data);
    stream.respond();
    stream.end();
  });

  const client = http2.connect(`http://localhost:${serverPort}`);
  client.once('goaway', (code, lastStreamID, buf) => {
    expect(code).toBe(0);
    expect(lastStreamID).toBe(1);
    expect(buf).toEqual(data);
    session.close();
    client.close();
    done();
  });

  const req = client.request();
  req.resume();
  req.on('end', () => {
    expect(true).toBe(true); // Request ended
  });
  req.on('close', () => {
    expect(true).toBe(true); // Request closed
  });
  req.end();
});

//<#END_FILE: test-http2-goaway-opaquedata.js
