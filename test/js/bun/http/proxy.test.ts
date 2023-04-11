import { which } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { gc } from "harness";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
type ProxyServer = { port: number | null; stop(): void };

let proxy: ProxyServer, auth_proxy: ProxyServer, server: ProxyServer, server_tls: ProxyServer;

const HTTP_PROXY_PATH = which("http_proxy");
const test = HTTP_PROXY_PATH ? it : it.skip;

const rawKeyFile = join(import.meta.dir, "../../node/tls", "fixtures", "rsa_private.pem");
const certFile = join(import.meta.dir, "../../node/tls", "fixtures", "rsa_cert.crt");

beforeAll(async () => {
  if (!HTTP_PROXY_PATH) return;

  function startProxyServer(options: Array<string>): Promise<ProxyServer> {
    return new Promise((resolve, reject) => {
      const proxy = spawn(HTTP_PROXY_PATH, options);
      proxy.stdout.on("data", data => {
        const [type, value] = data.toString().split(" ");

        switch (type) {
          case "[LISTEN]":
            let port = value?.trim()?.split(":")[1];
            if (port) {
              port = parseInt(port, 10);
            }
            resolve({
              port,
              stop() {
                proxy.kill();
              },
            });
          case "[LISTEN-FAILURE]":
            reject({ port: null, stop: () => {} });
            break;
          default:
            console.log("Unknown type", data.toString());
        }
      });
      if (proxy.exitCode) {
        reject({ port: null, stop: () => {} });
      }
    });
  }

  proxy = await startProxyServer(["--port", "0"]);
  auth_proxy = await startProxyServer(["--port", "0", "--auth", "squid_user:ASD@123asd"]);
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method === "POST") {
        const text = await request.text();
        return new Response(text, { status: 200 });
      }
      return new Response("Hello, World", { status: 200 });
    },
  });
  server_tls = Bun.serve({
    port: 0,
    certFile: certFile,
    keyFile: rawKeyFile,
    async fetch(request) {
      if (request.method === "POST") {
        const text = await request.text();
        return new Response(text, { status: 200 });
      }
      return new Response("Hello, World", { status: 200 });
    },
  });
});

afterAll(() => {
  if (!HTTP_PROXY_PATH) return;
  server.stop();
  proxy.stop();
  auth_proxy.stop();
  server_tls.stop();
});

for (let is_tls of [false, true]) {
  describe(`server ${is_tls ? "TLS" : "non-TLS"}`, () => {
    test("fetch proxy", async done => {
      const url = `${is_tls ? "https" : "http"}://127.0.0.1:${is_tls ? server_tls.port : server.port}`;
      const auth_proxy_url = `http://squid_user:ASD%40123asd@127.0.0.1:${auth_proxy.port}`;
      const proxy_url = `http://127.0.0.1:${proxy.port}`;
      const requests: Array<[Request | string, string]> = [
        [new Request(url), auth_proxy_url],
        [
          new Request(url, {
            method: "POST",
            body: "Hello, World",
          }),
          auth_proxy_url,
        ],
        [url, auth_proxy_url],
        [new Request(url), proxy_url],
        [
          new Request(url, {
            method: "POST",
            body: "Hello, World",
          }),
          proxy_url,
        ],
        [url, proxy_url],
      ];
      for (let [request, proxy] of requests) {
        try {
          gc();
          const response = await fetch(request, { keepalive: false, verbose: true, proxy });
          gc();
          expect(response.status).toBe(200);
        } catch (err) {
          console.error(err);
          expect(true).toBeFalsy();
        }
      }
      done();
    });

    test("fetch proxy auth can fail", async done => {
      const url = `${is_tls ? "https" : "http"}://localhost:${is_tls ? server_tls.port : server.port}`;
      {
        try {
          const response = await fetch(url, {
            keepalive: false,
            verbose: true,
            proxy: `http://localhost:${auth_proxy.port}`,
          });
          expect(response.status).toBe(407);
        } catch (err) {
          console.error(err);
          expect(true).toBeFalsy();
        }
      }

      {
        try {
          const response = await fetch(url, {
            keepalive: false,
            verbose: true,
            proxy: `http://squid_user:asdf123@localhost:${auth_proxy.port}`,
          });
          expect(response.status).toBe(403);
        } catch (err) {
          console.error(err);
          expect(true).toBeFalsy();
        }
      }

      done();
    });
  });
}
