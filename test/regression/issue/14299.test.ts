import http from 'node:http';

test('falsy path value', async () => {
  const server = http.createServer();
  server.listen({"path":false,"host":"0.0.0.0","port":"3000"});

  const { promise, resolve, reject } = Promise.withResolvers();

  server.on('error', reject);
  server.on('listening', () => {
    server.close();
    resolve();
  });

  await promise;
})
