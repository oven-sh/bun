import { expect, test } from "bun:test";
import { tempDir, tls } from "harness";

// Second self-signed certificate (different from harness.tls) for multi-cert testing.
// Generated with:
//   openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
//     -keyout second.key -out second.crt \
//     -subj "/CN=second-cert" \
//     -addext "subjectAltName = DNS:localhost,IP:127.0.0.1"
const tls2 = {
  cert: "-----BEGIN CERTIFICATE-----\nMIIDKTCCAhGgAwIBAgIUZmr3fzuH7P5T0HfaC0B6WctMNIMwDQYJKoZIhvcNAQEL\nBQAwFjEUMBIGA1UEAwwLc2Vjb25kLWNlcnQwHhcNMjYwMjIwMDIyNDI5WhcNMzYw\nMjE4MDIyNDI5WjAWMRQwEgYDVQQDDAtzZWNvbmQtY2VydDCCASIwDQYJKoZIhvcN\nAQEBBQADggEPADCCAQoCggEBAKE5QuatpD1I7XGcK0ZcF/ZCwXeZ7/NQ1HJQlLJM\ncc/T3waXzeBwB2ZnhnJjQsayc+hPQUZxbJIXfZHsqR7zwFoLopSSB17w3sT7eEP1\nlVlz1NytaLhzt3SHHgYVNtfx6pXF0bE1Bu7LD5fW5iheG9eMqKvRPehdXqhM07MF\noqj4iTFWvISnAJuWWJg+CLgqP3PJFaOlIINEt4vmk54m+2a1fa0fkWgzbyvcN0KD\nVhs53RsiNkwHnFRtlHq8Ns9YN6016zXULAYL6ou+MEqWx2lbpfdTwIedItmClD8+\nMrYX+z7BWNtzkir3cdjowx2v/6A6I56KWpIV21TmDM3FBoMCAwEAAaNvMG0wHQYD\nVR0OBBYEFNgFbucRW9em5k3oaZxKF2W5bsWSMB8GA1UdIwQYMBaAFNgFbucRW9em\n5k3oaZxKF2W5bsWSMA8GA1UdEwEB/wQFMAMBAf8wGgYDVR0RBBMwEYIJbG9jYWxo\nb3N0hwR/AAABMA0GCSqGSIb3DQEBCwUAA4IBAQCWmCF2lg/WxI/8ZTFccQe1CPob\nggtuNAskVf+wTNnbQCNgNTu7YTG/DJKwkJd2/v20rOtcBgwcKM+BS7CugPSJul5u\nYtKvXX7KeSYuHBI2zSLTOcrS8w90b9iqIgUh0ES+qD7vBvb0IBJ7xWBlaKasdPpO\nIuIIbPnehvCWnBPlZXdh2JvZ3yzve5YfUbPod0AqmsfIMCQ3TF3T70itXoL4Zasb\nkPlV6iSO5p2iL6MS5xPt6EhgLRXXhVQpnRLMYiFVAfCThMoyPL/uRQFaA02fplhZ\n7sJ4l6GT/pamxxZZcxNvZRReJfSdz4r1z9/PWUjNiKen5vSknSk7CLoSjFRX\n-----END CERTIFICATE-----\n",
  key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQChOULmraQ9SO1x\nnCtGXBf2QsF3me/zUNRyUJSyTHHP098Gl83gcAdmZ4ZyY0LGsnPoT0FGcWySF32R\n7Kke88BaC6KUkgde8N7E+3hD9ZVZc9TcrWi4c7d0hx4GFTbX8eqVxdGxNQbuyw+X\n1uYoXhvXjKir0T3oXV6oTNOzBaKo+IkxVryEpwCblliYPgi4Kj9zyRWjpSCDRLeL\n5pOeJvtmtX2tH5FoM28r3DdCg1YbOd0bIjZMB5xUbZR6vDbPWDetNes11CwGC+qL\nvjBKlsdpW6X3U8CHnSLZgpQ/PjK2F/s+wVjbc5Iq93HY6MMdr/+gOiOeilqSFdtU\n5gzNxQaDAgMBAAECggEAE7R18s/CRSNGsh4OQ/k5jIW4M7AC3dBBRv+GTQx+1JHm\nrl2bchT/MorwqcZsAPEKrZgSOFPgmzJ3zIAKY5gTKG5HnrUCZZ42/AhoOJYpfNdl\natte8zxhbcKd7sxk+Zu9ujSFXo1GnaT/8OT5GHH4IS4151oZoO7YhOVu8nB74v7b\nodDTtgxGHhNhf6BTgXxKgGx1nuriwW192d7gSIgqrP543ACZtK+JxC2ZFxGED49c\nQkTuXSK7MGVTqvq0MxVH6/h8L0cCU8EFIv7dcqcBuLY3wC1a6O+WLgJxylxpXw3U\nUOWfWzmjup6zNCS4uutzGCjA/dTygnoiMKLym6RzkQKBgQDcgUA4NElIxAX+2ReJ\nF4sawKVTZ0WvlRtxhQ5/WjFfz/GzH8l4X+2xiq6pN9jfDqzCunPo4BzB+pU70bSH\n+P2frWZO3yDGAqf9lqtA6HANes+PHnUPonC+4uoSDtm0t/JPsXCblF5NPWoy8tSW\n5CyHRCFsWsED6/76LMLs3uhADwKBgQC7LRnbFucDYmoTd1+rvQI4TOaV9Yh9AE5/\nguPFiOow/zzL8XPUeAdneXChY14bvJsLHNLYMKDjEm4LkBbbt04pP+jrCCsyiH4r\nFk/28P+IBOvTp41ZkjByGj5Cf7X/tCc5bnGmblyzkLneGMUTXwdmmjtS5DpWmm9z\nkrg15xgeTQKBgQCfRdUHQ+0zXDQgctrnMVRPDJvedJgHTaK3Cq8AGjvTwzYIdotm\nIZRlS5EBtc82vzjWpysWKNtc2g11WfIWzSkVb4CYs97OaBjDuVMV3U8izXSjIhLY\nKjNaDjmYtZVXTg7+tWJrXm4HSLcu+evI2iO3yOSDicIlfQ990VszEYeczQKBgQCP\nMusUFcp5aWKUMADOqBS5tAO5eJaKY6Cqpx3RM3VQNQVzVe9y/r1TabJElnwaJkpL\nzypz4YhFEQWF7R+/ytaOcmmk3qQFzi0Qk8prt2cXzgQJ8qcOfux3byJwx7oavd5A\nbwGd/dMIQdIhW7vynQJRee+m9Bq5xP89YWNzQbDPBQKBgCGA5yrSInv5/uNkuQx6\nucyXc0UDwkh1htqTXiT069qx5tZo7+scBwy9/6ZuVBLhwef1RoQcntfY04+cZrx6\nnPYowRNcQyOFToh3KZ1N7x03n8E0RaP+rSWboTCLDPLYJpzNI/fXeN6JhWyPxXfS\nuZxlT8fFsk4OEgNgzCEmAQTg\n-----END PRIVATE KEY-----\n",
};

test("Bun.listen with multiple cert/key arrays should not fail (#16912)", async () => {
  // This test verifies that passing arrays of certs and keys works.
  // Before the fix, this would fail with "Failed to listen" because
  // all certs were loaded first (each replacing the previous), then
  // all keys were validated against only the last cert, causing a mismatch.
  const listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
    tls: {
      key: [tls.key, tls2.key],
      cert: [tls.cert, tls2.cert],
    },
  });

  expect(listener.port).toBeGreaterThan(0);
  listener.stop(true);
});

test("Bun.serve with multiple cert/key arrays should not fail (#16912)", async () => {
  using server = Bun.serve({
    port: 0,
    tls: {
      key: [tls.key, tls2.key],
      cert: [tls.cert, tls2.cert],
    },
    fetch() {
      return new Response("ok");
    },
  });

  expect(server.port).toBeGreaterThan(0);

  const resp = await fetch(`https://localhost:${server.port}`, {
    tls: { rejectUnauthorized: false },
  });

  expect(resp.status).toBe(200);
  expect(await resp.text()).toBe("ok");
});

test("Bun.listen with multiple cert/key as BunFile arrays should not fail (#16912)", async () => {
  const { join } = require("path");

  using dir = tempDir("bun-tls-16912", {
    "first.key": tls.key,
    "first.crt": tls.cert,
    "second.key": tls2.key,
    "second.crt": tls2.cert,
  });

  const listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
    tls: {
      key: [Bun.file(join(String(dir), "first.key")), Bun.file(join(String(dir), "second.key"))],
      cert: [Bun.file(join(String(dir), "first.crt")), Bun.file(join(String(dir), "second.crt"))],
    },
  });

  expect(listener.port).toBeGreaterThan(0);
  listener.stop(true);
});

test("Bun.listen with multiple cert/key as Buffer arrays should not fail (#16912)", async () => {
  const listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
    tls: {
      key: [Buffer.from(tls.key), Buffer.from(tls2.key)],
      cert: [Buffer.from(tls.cert), Buffer.from(tls2.cert)],
    },
  });

  expect(listener.port).toBeGreaterThan(0);
  listener.stop(true);
});
