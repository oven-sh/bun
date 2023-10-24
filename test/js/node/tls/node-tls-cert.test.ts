import { expect, it } from "bun:test";
import tls from "tls";
import type { Server, TLSSocket } from "node:tls";
import type { AddressInfo } from "node:net";
import { join } from "path";
import { readFileSync } from "fs";

it("Check getPeerCertificate can properly handle '\\0' for fix CVE-2009-2408.", async () => {
  let server: Server | null = null;
  let socket: TLSSocket | null = null;
  try {
    const { promise, resolve, reject } = Promise.withResolvers();
    server = tls
      .createServer({
        key: readFileSync(join(import.meta.dir, "fixtures", "0-dns-key.pem")),
        cert: readFileSync(join(import.meta.dir, "fixtures", "0-dns-cert.pem")),
      })
      .on("error", reject)
      .listen(0, () => {
        const address = server?.address() as AddressInfo;
        socket = tls
          .connect(
            {
              host: address.address,
              port: address.port,
              rejectUnauthorized: false,
            },
            () => {
              const cert = socket?.getPeerCertificate();
              resolve(cert?.subjectaltname);
            },
          )
          .on("error", reject);
      });
    const subjectaltname = await promise;
    expect(subjectaltname).toBe(
      'DNS:"good.example.org\\u0000.evil.example.com", DNS:just-another.example.com, IP Address:8.8.8.8, IP Address:8.8.4.4, DNS:last.example.com',
    );
  } finally {
    //@ts-ignore
    socket?.end();
    server?.close();
  }
});

it("should not accept untrusted certificates", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  let server: Server | null = null;
  let socket: TLSSocket | null = null;

  try {
    server = tls
      .createServer({
        key: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.key")),
        cert: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.crt")),
        passphrase: "123123123",
      })
      .on("error", reject)
      .listen(0, () => {
        const address = server?.address() as AddressInfo;

        const options = {
          port: address.port,
          rejectUnauthorized: true,
          checkServerIdentity() {
            console.log(arguments);
          },
        };
        socket = tls
          .connect(options, () => {
            reject(new Error("should not connect"));
          })
          .on("error", resolve);
      });

    const err = await promise;
    expect(err.code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(err.message).toBe("unable to verify the first certificate");
  } finally {
    //@ts-ignore
    socket?.end();
    server?.close();
  }
});
