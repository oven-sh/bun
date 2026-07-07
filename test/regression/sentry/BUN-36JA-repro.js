// BUN-36JA repro: segfault in memcpy under SSL_read/SSL_peek from
// us_internal_ssl_on_data, Windows only.
//
// Mechanism: on the libuv event-loop backend (Windows) tick_depth is never
// bumped around uv_run, so when a TLS socket's data callback closes the
// socket and then synchronously re-enters the event loop, the nested
// uv_check runs us_internal_free_closed_sockets and frees the us_socket_t
// that the suspended outer us_internal_ssl_on_data frame is still reading.
// The outer frame then calls SSL_read on a freed SSL* -> memcpy into garbage.
//
// Expected on Windows release bun 1.4.0: crashes with
//   - Segfault @ 0x00000040 (SSL_peek memcpy)  or
//   - STATUS_HEAP_CORRUPTION (0xC0000374)
// before ROUNDS completes. Prints "SURVIVED <n>" if it doesn't crash.

const ROUNDS = Number(process.env.ROUNDS || 100);
const tls = Object.freeze({
  cert: "-----BEGIN CERTIFICATE-----\nMIID4jCCAsqgAwIBAgIUcaRq6J/YF++Bo01Zc+HeQvCbnWMwDQYJKoZIhvcNAQEL\nBQAwaTELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMRYwFAYDVQQHDA1TYW4gRnJh\nbmNpc2NvMQ0wCwYDVQQKDARPdmVuMREwDwYDVQQLDAhUZWFtIEJ1bjETMBEGA1UE\nAwwKc2VydmVyLWJ1bjAeFw0yNTA5MDYwMzAwNDlaFw0zNTA5MDQwMzAwNDlaMGkx\nCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJDQTEWMBQGA1UEBwwNU2FuIEZyYW5jaXNj\nbzENMAsGA1UECgwET3ZlbjERMA8GA1UECwwIVGVhbSBCdW4xEzARBgNVBAMMCnNl\ncnZlci1idW4wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDlYzosgRgX\nHL6vMh1V0ERFhsvlZrtRojSw6tafr3SQBphU793/rGiYZlL/lJ9HIlLkx9JMbuTj\nNm5U2eRwHiTQIeWD4aCIESwPlkdaVYtC+IOj55bJN8xNa7h5GyJwF7PnPetAsKyE\n8DMBn1gKMhaIis7HHOUtk4/K3Y4peU44d04z0yPt6JtY5Sbvi1E7pGX6T/2c9sHs\ndIDeDctWnewpXXs8zkAla0KNWQfpDnpS53wxAfStTA4lSrA9daxC7hZopQlLxFIb\nJk+0BLbEsXtrJ54T5iguHk+2MDVAy4MOqP9XbKV7eGHk73l6+CSwmHyHBxh4ChxR\nQeT5BP0MUTn1AgMBAAGjgYEwfzAdBgNVHQ4EFgQUw7nEnh4uOdZVZUapQzdAUaVa\nAn0wHwYDVR0jBBgwFoAUw7nEnh4uOdZVZUapQzdAUaVaAn0wDwYDVR0TAQH/BAUw\nAwEB/zAsBgNVHREEJTAjgglsb2NhbGhvc3SHBH8AAAGHEAAAAAAAAAAAAAAAAAAA\nAAEwDQYJKoZIhvcNAQELBQADggEBAEA8r1fvDLMSCb8bkAURpFk8chn8pl5MChzT\nYUDaLdCCBjPXJkSXNdyuwS+T/ljAGyZbW5xuDccCNKltawO4CbyEXUEZbYr3w9eq\nj8uqymJPhFf0O1rKOI2han5GBCgHwG13QwKI+4uu7390nD+TlzLOhxFfvOG7OadH\nQNMNLNyldgF4Nb8vWdz0FtQiGUIrO7iq4LFhhd1lCxe0q+FAYSEYcc74WtF/Yo8V\nJQauXuXyoP5FqLzNt/yeNQhceyIXJGKCsjr5/bASBmVlCwgRfsD3jpG37L8YCJs1\nL4WEikcY4Lzb2NF9e94IyZdQsRqd9DFBF5zP013MSUiuhiow32k=\n-----END CERTIFICATE-----\n",
  key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDlYzosgRgXHL6v\nMh1V0ERFhsvlZrtRojSw6tafr3SQBphU793/rGiYZlL/lJ9HIlLkx9JMbuTjNm5U\n2eRwHiTQIeWD4aCIESwPlkdaVYtC+IOj55bJN8xNa7h5GyJwF7PnPetAsKyE8DMB\nn1gKMhaIis7HHOUtk4/K3Y4peU44d04z0yPt6JtY5Sbvi1E7pGX6T/2c9sHsdIDe\nDctWnewpXXs8zkAla0KNWQfpDnpS53wxAfStTA4lSrA9daxC7hZopQlLxFIbJk+0\nBLbEsXtrJ54T5iguHk+2MDVAy4MOqP9XbKV7eGHk73l6+CSwmHyHBxh4ChxRQeT5\nBP0MUTn1AgMBAAECggEABtPvC5uVGr0DjQX2GxONsK8cOxoVec7U+C4pUMwBcXcM\nyjxwlHdujpi/IDXtjsm+A2rSPu2vGPdKDfMFanPvPxW/Ne99noc6U0VzHsR8lnP8\nwSB328nyJhzOeyZcXk9KTtgIPF7156gZsJLsZTNL+ej90i3xQWvKxCxXmrLuad5O\nz/TrgZkC6wC3fgj1d3e8bMljQ7tLxbshJMYVI5o6RFTxy84DLI+rlvPkf7XbiMPf\n2lsm4jcJKvfx+164HZJ9QVlx8ncqOHAnGvxb2xHHfqv4JAbz615t7yRvtaw4Paj5\n6kQSf0VWnsVzgxNJWvnUZym/i/Qf5nQafjChCyKOEQKBgQD9f4SkvJrp/mFKWLHd\nkDvRpSIIltfJsa5KShn1IHsQXFwc0YgyP4SKQb3Ckv+/9UFHK9EzM+WlPxZi7ZOS\nhsWhIfkI4c4ORpxUQ+hPi0K2k+HIY7eYyONqDAzw5PGkKBo3mSGMHDXYywSqexhB\nCCMHuHdMhwyHdz4PWYOK3C2VMQKBgQDnpsrHK7lM9aVb8wNhTokbK5IlTSzH/5oJ\nlAVu6G6H3tM5YQeoDXztbZClvrvKU8DU5UzwaC+8AEWQwaram29QIDpAI3nVQQ0k\ndmHHp/pCeADdRG2whaGcl418UJMMv8AUpWTRm+kVLTLqfTHBC0ji4NlCQMHCUCfd\nU8TeUi5QBQKBgQDvJNd7mboDOUmLG7VgMetc0Y4T0EnuKsMjrlhimau/OYJkZX84\n+BcPXwmnf4nqC3Lzs3B9/12L0MJLvZjUSHQ0mJoZOPxtF0vvasjEEbp0B3qe0wOn\nDQ0NRCUJNNKJbJOfE8VEKnDZ/lx+f/XXk9eINwvElDrLqUBQtr+TxjbyYQKBgAxQ\nlZ8Y9/TbajsFJDzcC/XhzxckjyjisbGoqNFIkfevJNN8EQgiD24f0Py+swUChtHK\njtiI8WCxMwGLCiYs9THxRKd8O1HW73fswy32BBvcfU9F//7OW9UTSXY+YlLfLrrq\nP/3UqAN0L6y/kxGMJAfLpEEdaC+IS1Y8yc531/ZxAoGASYiasDpePtmzXklDxk3h\njEw64QAdXK2p/xTMjSeTtcqJ7fvaEbg+Mfpxq0mdTjfbTdR9U/nzAkwS7OoZZ4Du\nueMVls0IVqcNnBtikG8wgdxN27b5JPXS+GzQ0zDSpWFfRPZiIh37BAXr0D1voluJ\nrEHkcals6p7hL98BoxjFIvA=\n-----END PRIVATE KEY-----\n",
});

let reentries = 0;
let dataFires = 0;

const server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  tls: { cert: tls.cert, key: tls.key },
  socket: {
    open() {},
    handshake() {},
    data(sock) {
      dataFires++;
      // 1) Close this TLS socket: us_internal_socket_close_raw puts it on
      //    loop->data.closed_head (ssl_in_use is 0 here: SSL_read already
      //    returned before dispatch_data called us).
      sock.terminate();
      // 2) Synchronously re-enter the event loop: the element handler returns
      //    a still-pending promise, so .transform() spins waitForPromise ->
      //    autoTick -> a nested us_loop_run. On Windows that nested check_cb
      //    runs us_internal_free_closed_sockets (tick_depth stayed 0), freeing
      //    the us_socket_t whose ssl_on_data frame we're still inside.
      new HTMLRewriter()
        .on("p", {
          element: () =>
            new Promise(r =>
              setImmediate(() => {
                reentries++;
                r();
              }),
            ),
        })
        .transform("<p></p>");
      // On return from this callback, us_internal_ssl_on_data reads s->... and
      // re-enters SSL_read on freed memory.
    },
    close() {},
    end() {},
    error() {},
  },
});

// Per-round: connect one TLS client, push >16KB so SSL_read delivers at least
// one full record and dispatch_data fires while more ciphertext is buffered
// (the "goto restart" path in us_internal_ssl_on_data).
const payload = Buffer.alloc(64 * 1024, 0x61);

for (let i = 0; i < ROUNDS; i++) {
  const { promise, resolve } = Promise.withResolvers();
  let settled = false;
  const done = () => {
    if (!settled) {
      settled = true;
      resolve();
    }
  };
  Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    tls: { ca: tls.cert, rejectUnauthorized: false },
    socket: {
      open() {},
      handshake(s) {
        s.write(payload);
      },
      data() {},
      close: done,
      end: done,
      error: done,
      connectError: done,
    },
  }).catch(done);
  await promise;
}

server.stop(true);
console.log("SURVIVED " + reentries + "/" + ROUNDS + " (data callbacks: " + dataFires + ")");
