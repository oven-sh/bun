//#FILE: test-net-listen-exclusive-random-ports.js
//#SHA1: d125e8ff5fd688b5638099581c08c78d91460c59
//-----------------
'use strict';

const net = require('net');

describe('Net listen exclusive random ports', () => {
  test('should listen on different ports for different servers', async () => {
    const createServer = () => {
      return new Promise((resolve, reject) => {
        const server = net.createServer(() => {});
        server.listen({
          port: 0,
          exclusive: true
        }, () => {
          const port = server.address().port;
          resolve({ server, port });
        });
        server.on('error', reject);
      });
    };

    const { server: server1, port: port1 } = await createServer();
    const { server: server2, port: port2 } = await createServer();

    expect(port1).toBe(port1 | 0);
    expect(port2).toBe(port2 | 0);
    expect(port1).not.toBe(port2);

    server1.close();
    server2.close();
  });
});

//<#END_FILE: test-net-listen-exclusive-random-ports.js
