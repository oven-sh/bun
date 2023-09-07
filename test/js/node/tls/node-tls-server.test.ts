import tls, { rootCertificates, connect, createServer, Server, TLSSocket } from "tls";
import type { PeerCertificate } from "tls";
import { realpathSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTest } from "node-harness";
import { AddressInfo } from "net";

const { describe, expect, it, createCallCheckCtx } = createTest(import.meta.path);

const passKeyFile = join(import.meta.dir, "fixtures", "rsa_private_encrypted.pem");
const passKey = readFileSync(passKeyFile);
const rawKeyFile = join(import.meta.dir, "fixtures", "rsa_private.pem");
const rawKey = readFileSync(rawKeyFile);
const certFile = join(import.meta.dir, "fixtures", "rsa_cert.crt");
const cert = readFileSync(certFile);

const COMMON_CERT: object = {
  cert: "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAKLdQVPy90jjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\nBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX\naWRnaXRzIFB0eSBMdGQwHhcNMTkwMjAzMTQ0OTM1WhcNMjAwMjAzMTQ0OTM1WjBF\nMQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50\nZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB\nCgKCAQEA7i7IIEdICTiSTVx+ma6xHxOtcbd6wGW3nkxlCkJ1UuV8NmY5ovMsGnGD\nhJJtUQ2j5ig5BcJUf3tezqCNW4tKnSOgSISfEAKvpn2BPvaFq3yx2Yjz0ruvcGKp\nDMZBXmB/AAtGyN/UFXzkrcfppmLHJTaBYGG6KnmU43gPkSDy4iw46CJFUOupc51A\nFIz7RsE7mbT1plCM8e75gfqaZSn2k+Wmy+8n1HGyYHhVISRVvPqkS7gVLSVEdTea\nUtKP1Vx/818/HDWk3oIvDVWI9CFH73elNxBkMH5zArSNIBTehdnehyAevjY4RaC/\nkK8rslO3e4EtJ9SnA4swOjCiqAIQEwIDAQABo1AwTjAdBgNVHQ4EFgQUv5rc9Smm\n9c4YnNf3hR49t4rH4yswHwYDVR0jBBgwFoAUv5rc9Smm9c4YnNf3hR49t4rH4ysw\nDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEATcL9CAAXg0u//eYUAlQa\nL+l8yKHS1rsq1sdmx7pvsmfZ2g8ONQGfSF3TkzkI2OOnCBokeqAYuyT8awfdNUtE\nEHOihv4ZzhK2YZVuy0fHX2d4cCFeQpdxno7aN6B37qtsLIRZxkD8PU60Dfu9ea5F\nDDynnD0TUabna6a0iGn77yD8GPhjaJMOz3gMYjQFqsKL252isDVHEDbpVxIzxPmN\nw1+WK8zRNdunAcHikeoKCuAPvlZ83gDQHp07dYdbuZvHwGj0nfxBLc9qt90XsBtC\n4IYR7c/bcLMmKXYf0qoQ4OzngsnPI5M+v9QEHvYWaKVwFY4CTcSNJEwfXw+BAeO5\nOA==\n-----END CERTIFICATE-----",
  key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDuLsggR0gJOJJN\nXH6ZrrEfE61xt3rAZbeeTGUKQnVS5Xw2Zjmi8ywacYOEkm1RDaPmKDkFwlR/e17O\noI1bi0qdI6BIhJ8QAq+mfYE+9oWrfLHZiPPSu69wYqkMxkFeYH8AC0bI39QVfOSt\nx+mmYsclNoFgYboqeZTjeA+RIPLiLDjoIkVQ66lznUAUjPtGwTuZtPWmUIzx7vmB\n+pplKfaT5abL7yfUcbJgeFUhJFW8+qRLuBUtJUR1N5pS0o/VXH/zXz8cNaTegi8N\nVYj0IUfvd6U3EGQwfnMCtI0gFN6F2d6HIB6+NjhFoL+QryuyU7d7gS0n1KcDizA6\nMKKoAhATAgMBAAECggEAd5g/3o1MK20fcP7PhsVDpHIR9faGCVNJto9vcI5cMMqP\n6xS7PgnSDFkRC6EmiLtLn8Z0k2K3YOeGfEP7lorDZVG9KoyE/doLbpK4MfBAwBG1\nj6AHpbmd5tVzQrnNmuDjBBelbDmPWVbD0EqAFI6mphXPMqD/hFJWIz1mu52Kt2s6\n++MkdqLO0ORDNhKmzu6SADQEcJ9Suhcmv8nccMmwCsIQAUrfg3qOyqU4//8QB8ZM\njosO3gMUesihVeuF5XpptFjrAliPgw9uIG0aQkhVbf/17qy0XRi8dkqXj3efxEDp\n1LSqZjBFiqJlFchbz19clwavMF/FhxHpKIhhmkkRSQKBgQD9blaWSg/2AGNhRfpX\nYq+6yKUkUD4jL7pmX1BVca6dXqILWtHl2afWeUorgv2QaK1/MJDH9Gz9Gu58hJb3\nymdeAISwPyHp8euyLIfiXSAi+ibKXkxkl1KQSweBM2oucnLsNne6Iv6QmXPpXtro\nnTMoGQDS7HVRy1on5NQLMPbUBQKBgQDwmN+um8F3CW6ZV1ZljJm7BFAgNyJ7m/5Q\nYUcOO5rFbNsHexStrx/h8jYnpdpIVlxACjh1xIyJ3lOCSAWfBWCS6KpgeO1Y484k\nEYhGjoUsKNQia8UWVt+uWnwjVSDhQjy5/pSH9xyFrUfDg8JnSlhsy0oC0C/PBjxn\nhxmADSLnNwKBgQD2A51USVMTKC9Q50BsgeU6+bmt9aNMPvHAnPf76d5q78l4IlKt\nwMs33QgOExuYirUZSgjRwknmrbUi9QckRbxwOSqVeMOwOWLm1GmYaXRf39u2CTI5\nV9gTMHJ5jnKd4gYDnaA99eiOcBhgS+9PbgKSAyuUlWwR2ciL/4uDzaVeDQKBgDym\nvRSeTRn99bSQMMZuuD5N6wkD/RxeCbEnpKrw2aZVN63eGCtkj0v9LCu4gptjseOu\n7+a4Qplqw3B/SXN5/otqPbEOKv8Shl/PT6RBv06PiFKZClkEU2T3iH27sws2EGru\nw3C3GaiVMxcVewdg1YOvh5vH8ZVlxApxIzuFlDvnAoGAN5w+gukxd5QnP/7hcLDZ\nF+vesAykJX71AuqFXB4Wh/qFY92CSm7ImexWA/L9z461+NKeJwb64Nc53z59oA10\n/3o2OcIe44kddZXQVP6KTZBd7ySVhbtOiK3/pCy+BQRsrC7d71W914DxNWadwZ+a\njtwwKjDzmPwdIXDSQarCx0U=\n-----END PRIVATE KEY-----",
  passphrase: "1234",
};

const socket_domain = join(realpathSync(tmpdir()), "node-tls-server.sock");

describe("tls.createServer listen", () => {
  it("should throw when no port or path when using options", done => {
    expect(() => createServer(COMMON_CERT).listen({ exclusive: true })).toThrow(
      'The argument \'options\' must have the property "port" or "path". Received {"exclusive":true}',
    );
    done();
  });

  it("should listen on IPv6 by default", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);
    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      0,
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen on IPv4", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      0,
      "0.0.0.0",
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("0.0.0.0");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv4");
        server.close();
        done();
      }),
    );
  });

  it("should call listening", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };

    server.on("error", closeAndFail).on(
      "listening",
      mustCall(() => {
        clearTimeout(timeout);
        server.close();
        done();
      }),
    );

    timeout = setTimeout(closeAndFail, 100);

    server.listen(0, "0.0.0.0");
  });

  it("should listen on localhost", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      0,
      "::1",
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::1");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen on localhost", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      0,
      "::1",
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::1");
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen without port or host", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen on unix domain socket", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      socket_domain,
      mustCall(() => {
        const address = server.address();
        expect(address).toStrictEqual(socket_domain);
        server.close();
        done();
      }),
    );
  });

  it("should not listen with wrong password", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer({
      key: passKey,
      passphrase: "invalid",
      cert: cert,
    });

    server.on("error", mustCall());
    let timeout: Timer;
    function closeAndFail() {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    }

    timeout = setTimeout(closeAndFail, 100);

    server.listen(0, "0.0.0.0", closeAndFail);
  });

  it("should not listen without cert", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer({
      key: passKey,
      passphrase: "invalid",
    });

    server.on("error", mustCall());

    let timeout: Timer;
    function closeAndFail() {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    }

    timeout = setTimeout(closeAndFail, 100);

    server.listen(0, "0.0.0.0", closeAndFail);
  });

  it("should not listen without password", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer({
      key: passKey,
      cert: cert,
    });

    server.on("error", mustCall());

    let timeout: Timer;
    function closeAndFail() {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    }

    timeout = setTimeout(closeAndFail, 100);

    server.listen(0, "0.0.0.0", closeAndFail);
  });
});

describe("tls.createServer", () => {
  it("should work with getCertificate", done => {
    let timeout: Timer;
    let client: TLSSocket | null = null;
    const server: Server = createServer(COMMON_CERT, socket => {
      socket.on("secure", () => {
        try {
          expect(socket).toBeDefined();
          const cert = socket.getCertificate() as PeerCertificate;
          expect(cert).toBeDefined();
          expect(cert.subject).toBeDefined();
          expect(cert.subject).toMatchObject({
            C: "AU",
            ST: "Some-State",
            O: "Internet Widgits Pty Ltd",
          });

          expect(cert.issuer).toBeDefined();
          expect(cert.issuer).toMatchObject({
            C: "AU",
            ST: "Some-State",
            O: "Internet Widgits Pty Ltd",
          });

          expect(cert.ca).toBeTrue();
          expect(cert.bits).toBe(2048);
          expect(cert.modulus).toBe(
            "EE2EC82047480938924D5C7E99AEB11F13AD71B77AC065B79E4C650A427552E57C366639A2F32C1A718384926D510DA3E6283905C2547F7B5ECEA08D5B8B4A9D23A048849F1002AFA67D813EF685AB7CB1D988F3D2BBAF7062A90CC6415E607F000B46C8DFD4157CE4ADC7E9A662C72536816061BA2A7994E3780F9120F2E22C38E8224550EBA9739D40148CFB46C13B99B4F5A6508CF1EEF981FA9A6529F693E5A6CBEF27D471B2607855212455BCFAA44BB8152D254475379A52D28FD55C7FF35F3F1C35A4DE822F0D5588F42147EF77A5371064307E7302B48D2014DE85D9DE87201EBE363845A0BF90AF2BB253B77B812D27D4A7038B303A30A2A8021013",
          );
          expect(cert.exponent).toBe("0x10001");
          expect(cert.pubkey).toBeInstanceOf(Buffer);
          // yes these spaces are intentional
          expect(cert.valid_from).toBe("Feb  3 14:49:35 2019 GMT");
          expect(cert.valid_to).toBe("Feb  3 14:49:35 2020 GMT");
          expect(cert.fingerprint).toBe("48:5F:4B:DB:FD:56:50:32:F0:27:84:3C:3F:B9:6C:DB:13:42:D2:D4");
          expect(cert.fingerprint256).toBe(
            "40:F9:8C:B8:9D:3C:0D:93:09:C4:A7:96:B8:A4:69:03:6C:DB:1B:83:C9:0E:76:AE:4A:F4:16:1A:A6:13:50:B2",
          );
          expect(cert.fingerprint512).toBe(
            "98:56:9F:C0:A7:21:AD:BE:F3:11:AD:78:17:61:7C:36:AE:85:AB:AC:9E:1E:BF:AA:F2:92:0D:8B:36:50:07:CF:7B:C3:16:19:0F:1F:B9:09:C9:45:9D:EC:C9:44:66:72:EE:EA:CF:74:23:13:B5:FB:E1:88:52:51:D2:C6:B6:4D",
          );
          expect(cert.serialNumber).toBe("A2DD4153F2F748E3");

          expect(cert.raw).toBeInstanceOf(Buffer);
          client?.end();
          server.close();
          done();
        } catch (err) {
          client?.end();
          server.close();
          done(err);
        }
      });
    });

    const closeAndFail = (err: any) => {
      clearTimeout(timeout);
      server.close();
      client?.end();
      done(err || "Timeout");
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 1000);

    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      client = connect({
        port: address.port,
        host: address.address,
      });
    });
  });
});

describe("tls.createServer events", () => {
  it("should receive data", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);
    let timeout: Timer;
    let client: any = null;
    let is_done = false;
    const onData = mustCall(data => {
      is_done = true;
      clearTimeout(timeout);
      server.close();
      expect(data.byteLength).toBe(5);
      expect(data.toString("utf8")).toBe("Hello");
      done();
    });

    const server: Server = createServer(COMMON_CERT, (socket: TLSSocket) => {
      socket.on("data", onData);
    });

    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      client?.end();
      mustNotCall("no data received")();
    };

    server.on("error", closeAndFail);

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        client = await Bun.connect({
          tls: true,
          hostname: address.address,
          port: address.port,
          socket: {
            data(socket) {},
            handshake(socket, success, verifyError) {
              if (socket.write("Hello")) {
                socket.end();
              }
            },
            connectError: closeAndFail, // connection failed
          },
        }).catch(closeAndFail);
      }),
    );
  });

  it("should call end", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);
    let timeout: Timer;
    let is_done = false;
    const onEnd = mustCall(() => {
      is_done = true;
      clearTimeout(timeout);
      server.close();
      done();
    });

    const server: Server = createServer(COMMON_CERT, (socket: TLSSocket) => {
      socket.on("end", onEnd);
      socket.end();
    });

    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      mustNotCall("end not called")();
    };
    server.on("error", closeAndFail);

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        await Bun.connect({
          tls: true,
          hostname: address.address,
          port: address.port,
          socket: {
            data(socket) {},
            open(socket) {},
            connectError: closeAndFail, // connection failed
          },
        }).catch(closeAndFail);
      }),
    );
  });

  it("should call close", done => {
    let closed = false;
    const server: Server = createServer(COMMON_CERT);
    server.listen().on("close", () => {
      closed = true;
    });
    server.close();
    expect(closed).toBe(true);
    done();
  });

  it("should call connection and drop", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    let timeout: Timer;
    let is_done = false;
    const server = createServer(COMMON_CERT);
    let maxClients = 2;
    server.maxConnections = maxClients - 1;

    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      mustNotCall("drop not called")();
    };

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);
    let connection_called = false;
    server
      .on(
        "connection",
        mustCall(() => {
          connection_called = true;
        }),
      )
      .on(
        "drop",
        mustCall(data => {
          is_done = true;
          server.close();
          clearTimeout(timeout);
          expect(data.localPort).toBeDefined();
          expect(data.remotePort).toBeDefined();
          expect(data.remoteFamily).toBeDefined();
          expect(data.localFamily).toBeDefined();
          expect(data.localAddress).toBeDefined();
          expect(connection_called).toBe(true);
          done();
        }),
      )
      .listen(async () => {
        const address = server.address() as AddressInfo;

        async function spawnClient() {
          await Bun.connect({
            tls: true,
            port: address?.port,
            hostname: address?.address,
            socket: {
              data(socket) {},
              handshake(socket, success, verifyError) {},
              open(socket) {
                socket.end();
              },
            },
          });
        }

        const promises = [];
        for (let i = 0; i < maxClients; i++) {
          promises.push(spawnClient());
        }
        await Promise.all(promises).catch(closeAndFail);
      });
  });

  it("should call error", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    let timeout: Timer;
    const server: Server = createServer(COMMON_CERT);

    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall("error not called")();
    };

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);

    server
      .on(
        "error",
        mustCall(err => {
          server.close();
          clearTimeout(timeout);
          expect(err).toBeDefined();
          done();
        }),
      )
      .listen(123456);
  });

  it("should call abort with signal", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const controller = new AbortController();
    let timeout: Timer;
    const server = createServer(COMMON_CERT);

    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall("close not called")();
    };

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);

    server
      .on(
        "close",
        mustCall(() => {
          clearTimeout(timeout);
          done();
        }),
      )
      .listen({ port: 0, signal: controller.signal }, () => {
        controller.abort();
      });
  });

  it("should echo data", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);
    let timeout: Timer;
    let client: any = null;
    const server: Server = createServer(COMMON_CERT, (socket: TLSSocket) => {
      socket.pipe(socket);
    });
    let is_done = false;
    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      client?.end();
      mustNotCall("no data received")();
    };

    server.on("error", closeAndFail);

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        client = await Bun.connect({
          tls: true,
          hostname: address.address,
          port: address.port,
          socket: {
            drain(socket) {
              socket.write("Hello");
            },
            data(socket, data) {
              is_done = true;
              clearTimeout(timeout);
              server.close();
              socket.end();
              expect(data.byteLength).toBe(5);
              expect(data.toString("utf8")).toBe("Hello");
              done();
            },
            handshake(socket) {
              socket.write("Hello");
            },
            connectError: closeAndFail, // connection failed
          },
        }).catch(closeAndFail);
      }),
    );
  });
});

it("tls.rootCertificates should exists", () => {
  expect(tls.rootCertificates).toBeDefined();
  expect(tls.rootCertificates).toBeInstanceOf(Array);
  expect(tls.rootCertificates.length).toBeGreaterThan(0);
  expect(typeof tls.rootCertificates[0]).toBe("string");

  expect(rootCertificates).toBeDefined();
  expect(rootCertificates).toBeInstanceOf(Array);
  expect(rootCertificates.length).toBeGreaterThan(0);
  expect(typeof rootCertificates[0]).toBe("string");
});
