//#FILE: test-stream2-httpclient-response-end.js
//#SHA1: 8f19a7f93141826753b76c17e5741a521c15c79c
//-----------------
'use strict';
const http = require('http');

let server;

beforeAll((done) => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hello');
  }).listen(0, () => {
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

test('HTTP client response end event', (done) => {
  const port = server.address().port;
  
  http.get({ port: port }, (res) => {
    let data = '';
    
    const readableSpy = jest.fn(() => {
      console.log('readable event');
      let chunk;
      while ((chunk = res.read()) !== null) {
        data += chunk;
      }
    });
    
    res.on('readable', readableSpy);
    
    res.on('end', () => {
      console.log('end event');
      expect(data).toBe('Hello');
      expect(readableSpy).toHaveBeenCalled();
      done();
    });
  });
});

//<#END_FILE: test-stream2-httpclient-response-end.js
