//#FILE: test-http2-priority-cycle-.js
//#SHA1: 32c70d0d1e4be42834f071fa3d9bb529aa4ea1c1
//-----------------
'use strict';

const http2 = require('http2');

const largeBuffer = Buffer.alloc(1e4);

class Countdown {
  constructor(count, done) {
    this.count = count;
    this.done = done;
  }

  dec() {
    this.count--;
    if (this.count === 0) this.done();
  }
}

test('HTTP/2 priority cycle', (done) => {
  const server = http2.createServer();

  server.on('stream', (stream) => {
    stream.respond();
    setImmediate(() => {
      stream.end(largeBuffer);
    });
  });

  server.on('session', (session) => {
    session.on('priority', (id, parent, weight, exclusive) => {
      expect(weight).toBe(16);
      expect(exclusive).toBe(false);
      switch (id) {
        case 1:
          expect(parent).toBe(5);
          break;
        case 3:
          expect(parent).toBe(1);
          break;
        case 5:
          expect(parent).toBe(3);
          break;
        default:
          fail('should not happen');
      }
    });
  });

  server.listen(0, () => {
    const client = http2.connect(`http://localhost:${server.address().port}`);

    const countdown = new Countdown(3, () => {
      client.close();
      server.close();
      done();
    });

    {
      const req = client.request();
      req.priority({ parent: 5 });
      req.resume();
      req.on('close', () => countdown.dec());
    }

    {
      const req = client.request();
      req.priority({ parent: 1 });
      req.resume();
      req.on('close', () => countdown.dec());
    }

    {
      const req = client.request();
      req.priority({ parent: 3 });
      req.resume();
      req.on('close', () => countdown.dec());
    }
  });
});

//<#END_FILE: test-http2-priority-cycle-.js
