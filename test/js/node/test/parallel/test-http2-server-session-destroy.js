'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');
const h2 = require('http2');

const server = h2.createServer();
server.listen(0, "127.0.0.1", common.mustCall(() => {
  const afterConnect = common.mustCall((session) => {
    
    session.request({ ':method': 'POST' }).end(common.mustCall(() => {
      session.destroy();
      server.close();
    }));
  });

  const port = server.address().port;
  const host = "127.0.0.1";
  h2.connect(`http://${host}:${port}`, afterConnect);
}));
