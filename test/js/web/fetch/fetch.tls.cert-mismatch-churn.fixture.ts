// Fixture for "rejects a trusted cert with a mismatched hostname cleanly under churn".
//
// Reproduces the traffic shape behind a family of HTTP-thread use-after-free
// crashes (sentry BUN-2WC6 and siblings): TLS connections whose certificate
// chain is trusted but whose hostname does not match, with the server
// speaking first so SSL_read completes the handshake from the data path
// (on_handshake fires from us_internal_ssl_on_data), racing AbortSignal
// timeouts, keepalive pool churn, and handshakes that stall and are torn down
// mid-handshake while the HTTP thread is busy with all of the above.
//
// Prints one JSON line: the count of every outcome class plus the list of
// unexpected outcomes. The test asserts the exact shape, so a phase that
// silently stops running fails it. Exits non-zero on any unexpected outcome.
import tls from "node:tls";
import net from "node:net";
// Harness localhost cert (test/harness.ts `tls`): valid for localhost/127.0.0.1,
// self-signed so it doubles as its own CA.
const validTls = {
  cert: "-----BEGIN CERTIFICATE-----\nMIID4jCCAsqgAwIBAgIUcaRq6J/YF++Bo01Zc+HeQvCbnWMwDQYJKoZIhvcNAQEL\nBQAwaTELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMRYwFAYDVQQHDA1TYW4gRnJh\nbmNpc2NvMQ0wCwYDVQQKDARPdmVuMREwDwYDVQQLDAhUZWFtIEJ1bjETMBEGA1UE\nAwwKc2VydmVyLWJ1bjAeFw0yNTA5MDYwMzAwNDlaFw0zNTA5MDQwMzAwNDlaMGkx\nCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJDQTEWMBQGA1UEBwwNU2FuIEZyYW5jaXNj\nbzENMAsGA1UECgwET3ZlbjERMA8GA1UECwwIVGVhbSBCdW4xEzARBgNVBAMMCnNl\ncnZlci1idW4wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDlYzosgRgX\nHL6vMh1V0ERFhsvlZrtRojSw6tafr3SQBphU793/rGiYZlL/lJ9HIlLkx9JMbuTj\nNm5U2eRwHiTQIeWD4aCIESwPlkdaVYtC+IOj55bJN8xNa7h5GyJwF7PnPetAsKyE\n8DMBn1gKMhaIis7HHOUtk4/K3Y4peU44d04z0yPt6JtY5Sbvi1E7pGX6T/2c9sHs\ndIDeDctWnewpXXs8zkAla0KNWQfpDnpS53wxAfStTA4lSrA9daxC7hZopQlLxFIb\nJk+0BLbEsXtrJ54T5iguHk+2MDVAy4MOqP9XbKV7eGHk73l6+CSwmHyHBxh4ChxR\nQeT5BP0MUTn1AgMBAAGjgYEwfzAdBgNVHQ4EFgQUw7nEnh4uOdZVZUapQzdAUaVa\nAn0wHwYDVR0jBBgwFoAUw7nEnh4uOdZVZUapQzdAUaVaAn0wDwYDVR0TAQH/BAUw\nAwEB/zAsBgNVHREEJTAjgglsb2NhbGhvc3SHBH8AAAGHEAAAAAAAAAAAAAAAAAAA\nAAEwDQYJKoZIhvcNAQELBQADggEBAEA8r1fvDLMSCb8bkAURpFk8chn8pl5MChzT\nYUDaLdCCBjPXJkSXNdyuwS+T/ljAGyZbW5xuDccCNKltawO4CbyEXUEZbYr3w9eq\nj8uqymJPhFf0O1rKOI2han5GBCgHwG13QwKI+4uu7390nD+TlzLOhxFfvOG7OadH\nQNMNLNyldgF4Nb8vWdz0FtQiGUIrO7iq4LFhhd1lCxe0q+FAYSEYcc74WtF/Yo8V\nJQauXuXyoP5FqLzNt/yeNQhceyIXJGKCsjr5/bASBmVlCwgRfsD3jpG37L8YCJs1\nL4WEikcY4Lzb2NF9e94IyZdQsRqd9DFBF5zP013MSUiuhiow32k=\n-----END CERTIFICATE-----\n",
  key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDlYzosgRgXHL6v\nMh1V0ERFhsvlZrtRojSw6tafr3SQBphU793/rGiYZlL/lJ9HIlLkx9JMbuTjNm5U\n2eRwHiTQIeWD4aCIESwPlkdaVYtC+IOj55bJN8xNa7h5GyJwF7PnPetAsKyE8DMB\nn1gKMhaIis7HHOUtk4/K3Y4peU44d04z0yPt6JtY5Sbvi1E7pGX6T/2c9sHsdIDe\nDctWnewpXXs8zkAla0KNWQfpDnpS53wxAfStTA4lSrA9daxC7hZopQlLxFIbJk+0\nBLbEsXtrJ54T5iguHk+2MDVAy4MOqP9XbKV7eGHk73l6+CSwmHyHBxh4ChxRQeT5\nBP0MUTn1AgMBAAECggEABtPvC5uVGr0DjQX2GxONsK8cOxoVec7U+C4pUMwBcXcM\nyjxwlHdujpi/IDXtjsm+A2rSPu2vGPdKDfMFanPvPxW/Ne99noc6U0VzHsR8lnP8\nwSB328nyJhzOeyZcXk9KTtgIPF7156gZsJLsZTNL+ej90i3xQWvKxCxXmrLuad5O\nz/TrgZkC6wC3fgj1d3e8bMljQ7tLxbshJMYVI5o6RFTxy84DLI+rlvPkf7XbiMPf\n2lsm4jcJKvfx+164HZJ9QVlx8ncqOHAnGvxb2xHHfqv4JAbz615t7yRvtaw4Paj5\n6kQSf0VWnsVzgxNJWvnUZym/i/Qf5nQafjChCyKOEQKBgQD9f4SkvJrp/mFKWLHd\nkDvRpSIIltfJsa5KShn1IHsQXFwc0YgyP4SKQb3Ckv+/9UFHK9EzM+WlPxZi7ZOS\nhsWhIfkI4c4ORpxUQ+hPi0K2k+HIY7eYyONqDAzw5PGkKBo3mSGMHDXYywSqexhB\nCCMHuHdMhwyHdz4PWYOK3C2VMQKBgQDnpsrHK7lM9aVb8wNhTokbK5IlTSzH/5oJ\nlAVu6G6H3tM5YQeoDXztbZClvrvKU8DU5UzwaC+8AEWQwaram29QIDpAI3nVQQ0k\ndmHHp/pCeADdRG2whaGcl418UJMMv8AUpWTRm+kVLTLqfTHBC0ji4NlCQMHCUCfd\nU8TeUi5QBQKBgQDvJNd7mboDOUmLG7VgMetc0Y4T0EnuKsMjrlhimau/OYJkZX84\n+BcPXwmnf4nqC3Lzs3B9/12L0MJLvZjUSHQ0mJoZOPxtF0vvasjEEbp0B3qe0wOn\nDQ0NRCUJNNKJbJOfE8VEKnDZ/lx+f/XXk9eINwvElDrLqUBQtr+TxjbyYQKBgAxQ\nlZ8Y9/TbajsFJDzcC/XhzxckjyjisbGoqNFIkfevJNN8EQgiD24f0Py+swUChtHK\njtiI8WCxMwGLCiYs9THxRKd8O1HW73fswy32BBvcfU9F//7OW9UTSXY+YlLfLrrq\nP/3UqAN0L6y/kxGMJAfLpEEdaC+IS1Y8yc531/ZxAoGASYiasDpePtmzXklDxk3h\njEw64QAdXK2p/xTMjSeTtcqJ7fvaEbg+Mfpxq0mdTjfbTdR9U/nzAkwS7OoZZ4Du\nueMVls0IVqcNnBtikG8wgdxN27b5JPXS+GzQ0zDSpWFfRPZiIh37BAXr0D1voluJ\nrEHkcals6p7hL98BoxjFIvA=\n-----END PRIVATE KEY-----\n",
};

// Self-signed cert (its own CA) whose SAN is only DNS:wrong.example, so
// passing it as `ca` makes the chain trusted while hostname verification
// against "localhost" must fail with ERR_TLS_CERT_ALTNAME_INVALID.
const mismatchedTls = {
  cert: "-----BEGIN CERTIFICATE-----\nMIID0zCCArugAwIBAgIUeeJvzODsvS5vWYogT7IJhM5u3wMwDQYJKoZIhvcNAQEL\nBQAwbDELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMRYwFAYDVQQHDA1TYW4gRnJh\nbmNpc2NvMQ0wCwYDVQQKDARPdmVuMREwDwYDVQQLDAhUZWFtIEJ1bjEWMBQGA1UE\nAwwNd3JvbmcuZXhhbXBsZTAeFw0yNjA2MDkxNjE4NDFaFw0zNjA2MDYxNjE4NDFa\nMGwxCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJDQTEWMBQGA1UEBwwNU2FuIEZyYW5j\naXNjbzENMAsGA1UECgwET3ZlbjERMA8GA1UECwwIVGVhbSBCdW4xFjAUBgNVBAMM\nDXdyb25nLmV4YW1wbGUwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCt\nOMsk7M5X9jX7Jp5DjC/CgPxaDmDmv5Thy/9jwiVsKBQySwVxHot3/O7Y7yerFPHb\n7hqK6rADyTVPH3OIFrmd81craTr02Zby4iDJXZfmG/Iv7aeX0w79Ma56bapiHBXN\n1Uujt2Beuy6mCFfsWpfeMmbhLVu/VfJYWXAEdQDyu4v8vZtJhBiwpike+Pwso+Sn\nD42UESH2Cn/AJcGxiUyKs8R2x3od+eN+gE3wFbEbzNru3dbiqtjNNv5ixOoZaFJn\nj20EyPotp9jGcPzUZBZ5YnKeCD3RzR0neWNBIi6zn2JmMX/VOns3GduBB1iWaRgY\nA3fbqI4kLeqZujf7f0RjAgMBAAGjbTBrMB0GA1UdDgQWBBQ9dpQdhgH/W4kwAYXX\nH4osejnfpTAfBgNVHSMEGDAWgBQ9dpQdhgH/W4kwAYXXH4osejnfpTAPBgNVHRMB\nAf8EBTADAQH/MBgGA1UdEQQRMA+CDXdyb25nLmV4YW1wbGUwDQYJKoZIhvcNAQEL\nBQADggEBAJeGJIq28/pqkDZxKXEaGyXj7vNGv2qYowXmgISSfB9KMsD/k2Elsfpl\nClRey1GBwQaAnmziIs9iEO4rdvtsHwrwvTy3lQlIs1KtUIIMvZMDKKT1vigYCPiT\nQhyOGblTuzkPQ+7m0vJhsLzyY3PDB9I24LT04IREU7mT9oMXq6we0JQfzNUGeA3a\nTOPQH3CpNuzkk8SQBk7bLU8+B3ie2yO2FFIinngyIECgWkAe7O3C3o62f6N38gE2\nfgOrPu6g1SkcpPC2Zn37Lafg1BVcE1rHeBwgYmvmgHVZmqj38gSgJkmNd6iKeD+X\nIO0Q1sOjMdaQGbjrPa62Afhyb83FpPQ=\n-----END CERTIFICATE-----\n",
  key: "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCtOMsk7M5X9jX7\nJp5DjC/CgPxaDmDmv5Thy/9jwiVsKBQySwVxHot3/O7Y7yerFPHb7hqK6rADyTVP\nH3OIFrmd81craTr02Zby4iDJXZfmG/Iv7aeX0w79Ma56bapiHBXN1Uujt2Beuy6m\nCFfsWpfeMmbhLVu/VfJYWXAEdQDyu4v8vZtJhBiwpike+Pwso+SnD42UESH2Cn/A\nJcGxiUyKs8R2x3od+eN+gE3wFbEbzNru3dbiqtjNNv5ixOoZaFJnj20EyPotp9jG\ncPzUZBZ5YnKeCD3RzR0neWNBIi6zn2JmMX/VOns3GduBB1iWaRgYA3fbqI4kLeqZ\nujf7f0RjAgMBAAECggEAI4q+q+Hm6Md9Bf5DhOqTth4PKU8/9LikjLv1t/tTAGEs\n27Dm+fHhfgoo29weUI0onw645X4IBY7YYFa8ttSq20zduuuJjEnFHirlvUt16mIb\njFgABjfpIGx8N2SfDChlFOnJ7lqm7GkNxkV5/OYNuSqwT02mQJka86PORyvWuPcJ\nX6NmhhEJDCnVTL1D7FaEHrRUCC0n4hDMe0LLRNo7JrGljPIqPvpuQXEP52wdbzMC\nYfXJb7NbsiGOKLfrs9RXnR9ztr04gJ7jD5pMoeubbsM/tivRDm2VOY/U3NK2LN2q\ngFJ4hokBbUtIxU46RCTWSyQRRpNzFIBrL5y3a30DOQKBgQDsd/jvDPg55TzCNxFq\n6gLuoemIu4JIkSG4hSn6dtSpE5myQl9HuKvGlIS/kgB44zly8X8havxDuAinpzJc\n+oCnFWOFqi2IOt+OhiqjgeK2p0nsAxFVgWepdnPpv0LZXTj2SR09ZZ74YTh+ZQV8\nBiSuuEKZ064wwAg6esXVEMpkHwKBgQC7h360xoo/+m/ncANtDuA7zuHtE8fdsUaM\nLJ+zqlBsivsmM7ohqKqreIMKdw9b1aW/WrVmJavj9zX8ht/kt8vAYwmjk3lc7wso\nEa7EKF7Qa/IPhDkxQwnn/XTpzFsitItn1JCnnwoQUWcGtH/Su6b2I6T8+WZ8ia4Z\nXFpjyeV3PQKBgFVm2uPTBk86iGAILWU0kMyIc2RrfBkjOU9/4HJRumo55vdnWyv2\n+Srl9q+NVlhSkCwAJg72qZb3f0C1dM35tr8hTWk31evuf1DlCb81qKCY+GyhiwAb\nlUmxuxk/dzAzp9/i9gl3ixtfWVzktT9epJ7pczxFJBL9N7uPHaXew4m3AoGAUwwT\nKb2O9fxTWFv7uG1REktxNAuBhIUAaA1PAELZcOgvhuB7enJ2eo9ZAOZvD81SpKZo\nFP9z2vXcm6OjPWfDvMRfPWiO44AdIbaK/eWe75AOV57HsTAuD+Xnw64zYfAwmF/D\nW+gLjeRuysJepRVjQDfS1hEguOBEEIkconqDu0UCgYAQpb1SRymW/40bD3cTnF41\nDPH6Veqgdzu/6MOlD3oWTugPisH1aPq4UIsK03h+NJlVemQ92fTW47ZUjBuRZojZ\nrxah/Jl1Ta1Ww1q98fpZ2julkm+zEmErTw6plfveSVMC+jmgRjWXGbXYPxfxcUsb\nQlPkp7bJgio6h32XI0nWzA==\n-----END PRIVATE KEY-----\n",
};

function listen(server: net.Server): Promise<number> {
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
  });
}

// Trusted chain, wrong hostname. Speaks first: the HTTP response bytes ride
// right behind the server's handshake flight, so the client's SSL_read both
// completes the handshake and surfaces app data in one read event.
const mismatchServer = tls.createServer({ key: mismatchedTls.key, cert: mismatchedTls.cert }, socket => {
  socket.on("error", () => {});
  socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
});

// Valid cert, keepalive churn: normal responses, redirects, and mid-response
// hangups so pooled sockets get reused, retried, and torn down.
let goodHits = 0;
const goodServer = tls.createServer({ key: validTls.key, cert: validTls.cert }, socket => {
  socket.on("error", () => {});
  socket.on("data", () => {
    const n = goodHits++;
    switch (n % 5) {
      case 0:
        socket.write("HTTP/1.1 302 Found\r\nLocation: /next\r\nContent-Length: 0\r\n\r\n");
        break;
      case 1:
        socket.destroy();
        break;
      case 2:
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial");
        setTimeout(() => socket.destroy(), 5);
        break;
      default:
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
    }
  });
});

// Accepts TCP, never answers the ClientHello, so every fetch to it parks
// mid-handshake until the fixture aborts it. The teardown then runs on a TLS
// socket whose handshake never finished: the close callback fires
// on_handshake, and the client must still deliver exactly one final result.
// HTTPClient::on_timeout takes the same path, but the idle timer cannot fire
// before uSockets' 4s sweep tick; bun-install-stalled-tls.test.ts covers it.
const STALLED = 3;
let stalledClientHellos = 0;
const { promise: allStalled, resolve: onAllStalled } = Promise.withResolvers<void>();
const stallServer = net.createServer(socket => {
  socket.on("error", () => {});
  socket.once("data", () => {
    if (++stalledClientHellos === STALLED) onAllStalled();
  });
});

const mismatchPort = await listen(mismatchServer);
const goodPort = await listen(goodServer);
const stallPort = await listen(stallServer);

const counts = {
  // Plain mismatched-cert fetches: every one must reject with the altname error.
  mismatch: { altname: 0 },
  // Mismatched-cert fetches racing an AbortSignal: either side may win.
  racedMismatch: { altname: 0, aborted: 0 },
  // Valid cert through the keepalive pool: completes, or dies to the churn.
  keepalive: { ok: 0, churn: 0 },
  // Handshakes that never complete, torn down by the fixture's abort.
  stalled: { aborted: 0 },
};
const failures: string[] = [];

function errorCode(err: any): string {
  return typeof err?.code === "string" ? err.code : String(err?.name ?? err);
}

// Launched up front so the stalled sockets sit on the HTTP thread for the
// whole run and their teardown lands while it is busy with the batches.
const stallControllers: AbortController[] = [];
const stallJobs: Promise<void>[] = [];
for (let i = 0; i < STALLED; i++) {
  const controller = new AbortController();
  stallControllers.push(controller);
  stallJobs.push(
    fetch(`https://localhost:${stallPort}/`, {
      tls: { ca: validTls.cert },
      signal: controller.signal,
    }).then(
      res => {
        failures.push(`stalled handshake fetch resolved with status ${res.status}`);
      },
      err => {
        if (errorCode(err) === "AbortError") {
          counts.stalled.aborted++;
        } else {
          failures.push(`stalled handshake fetch rejected with ${errorCode(err)}`);
        }
      },
    ),
  );
}

const BATCHES = 16;
// Spread the stalled-handshake teardowns over the run: one every `abortEvery`
// batches (4, 8 and 12), each right after that batch's connects and handshakes
// were queued on the HTTP thread, so the teardown lands while it is busy.
const abortEvery = Math.floor(BATCHES / (STALLED + 1));
for (let batch = 0; batch < BATCHES; batch++) {
  const jobs: Promise<void>[] = [];

  // Plain mismatched-cert fetches: must reject with the altname error.
  for (let i = 0; i < 4; i++) {
    jobs.push(
      fetch(`https://localhost:${mismatchPort}/`, { tls: { ca: mismatchedTls.cert }, keepalive: false }).then(
        res => {
          failures.push(`mismatched cert fetch resolved with status ${res.status}`);
        },
        err => {
          if (errorCode(err) === "ERR_TLS_CERT_ALTNAME_INVALID") {
            counts.mismatch.altname++;
          } else {
            failures.push(`mismatched cert fetch rejected with ${errorCode(err)}`);
          }
        },
      ),
    );
  }

  // Mismatched-cert fetches with aborts racing connect/handshake/failure delivery.
  for (let i = 0; i < 4; i++) {
    jobs.push(
      fetch(`https://localhost:${mismatchPort}/`, {
        tls: { ca: mismatchedTls.cert },
        keepalive: false,
        signal: AbortSignal.timeout(i * 2),
      }).then(
        res => {
          failures.push(`aborted mismatched cert fetch resolved with status ${res.status}`);
        },
        err => {
          const code = errorCode(err);
          if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
            counts.racedMismatch.altname++;
          } else if (code === "TimeoutError") {
            counts.racedMismatch.aborted++;
          } else {
            failures.push(`aborted mismatched cert fetch rejected with ${code}`);
          }
        },
      ),
    );
  }

  // Keepalive churn against the valid-cert server, some aborted.
  for (let i = 0; i < 4; i++) {
    jobs.push(
      fetch(`https://localhost:${goodPort}/`, {
        tls: { ca: validTls.cert },
        signal: i % 2 === 0 ? AbortSignal.timeout(5 + i) : undefined,
      })
        .then(res => res.text())
        .then(
          () => counts.keepalive.ok++,
          err => {
            const code = errorCode(err);
            // redirect-target 302s loop back to the same handler; hangups and
            // truncation surface as ECONNRESET-flavored errors.
            if (code === "TimeoutError" || code === "ECONNRESET" || code === "ConnectionClosed") {
              counts.keepalive.churn++;
            } else {
              failures.push(`good cert fetch rejected with ${code}`);
            }
          },
        ),
    );
  }

  if (batch > 0 && batch % abortEvery === 0) {
    // The server has seen each ClientHello, so every abort hits a socket that
    // is connected and parked mid-handshake, never one still connecting.
    await allStalled;
    stallControllers.shift()?.abort();
  }

  await Promise.all(jobs);
}

await Promise.all(stallJobs);

mismatchServer.close();
goodServer.close();
stallServer.close();

// The first few failures are enough to diagnose; hundreds would drown the diff.
console.log(JSON.stringify({ ...counts, failures: failures.slice(0, 10) }));
// Keepalive server-side sockets survive server.close() and would keep the
// process alive; everything is settled at this point.
process.exit(failures.length > 0 ? 1 : 0);
