// Tests for the `groups` / `ecdhCurve` TLS option (KEX/KEM group selection).
//
// Default behavior: BUN_DEFAULT_SSL_GROUPS ("X25519MLKEM768:X25519:P-256:P-384")
// is applied at the SSL_CTX construction site when the caller does not pass
// an explicit `groups` (or Node-compat `ecdhCurve`) option.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import type { AddressInfo } from "net";
import { join } from "path";
import tls from "tls";

const cert = readFileSync(join(import.meta.dir, "fixtures", "agent1-cert.pem"), "utf8");
const key = readFileSync(join(import.meta.dir, "fixtures", "agent1-key.pem"), "utf8");
const ca = readFileSync(join(import.meta.dir, "fixtures", "ca1-cert.pem"), "utf8");

// `tls.TlsOptions` isn't reliably exported across Bun's bundled types; the
// real shape is structural so a permissive type avoids drift between Bun and
// `@types/node` versions. The runtime accepts the documented fields.
function listenLocal(
  serverOpts: Record<string, unknown>,
): Promise<{ server: tls.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = tls.createServer(serverOpts, sock => sock.end()).on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

describe("tls groups option", () => {
  it("default tls.connect (no option) negotiates a handshake", async () => {
    const { server, port } = await listenLocal({ key, cert });
    try {
      const ok = await new Promise<boolean>((resolve, reject) => {
        const s = tls.connect({ host: "127.0.0.1", port, ca, servername: "agent1" }, () => {
          s.end();
          resolve(true);
        });
        s.on("error", reject);
      });
      expect(ok).toBe(true);
    } finally {
      server.close();
    }
  });

  it("tls.connect honors `groups` option (proves option reached SSL_CTX)", async () => {
    // Server uses Bun default (PQ-friendly). Client constrains to
    // classical-only. Negotiated group must be X25519, proving the client's
    // `groups` option actually replaced the default at SSL_CTX construction
    // (without it, both sides default to BUN_DEFAULT and would pick MLKEM).
    const { server, port } = await listenLocal({ key, cert });
    try {
      const group = await new Promise<string | null>((resolve, reject) => {
        const s = tls.connect(
          { host: "127.0.0.1", port, ca, servername: "agent1", groups: "X25519:P-256:P-384" },
          () => {
            const g = s.getSharedGroup?.();
            s.end();
            resolve(g ?? null);
          },
        );
        s.on("error", reject);
      });
      expect(group).toBe("X25519");
    } finally {
      server.close();
    }
  });

  it("tls.connect honors `ecdhCurve` Node-compat alias (proves alias reached SSL_CTX)", async () => {
    const { server, port } = await listenLocal({ key, cert });
    try {
      const group = await new Promise<string | null>((resolve, reject) => {
        const s = tls.connect(
          { host: "127.0.0.1", port, ca, servername: "agent1", ecdhCurve: "P-256" },
          () => {
            const g = s.getSharedGroup?.();
            s.end();
            resolve(g ?? null);
          },
        );
        s.on("error", reject);
      });
      // Restricted to a single classical group via the legacy alias name.
      expect(group).toBe("P-256");
    } finally {
      server.close();
    }
  });

  it("tls.connect rejects non-string `groups`", () => {
    let caught: any;
    let socket: tls.TLSSocket | undefined;
    try {
      socket = tls.connect({ host: "127.0.0.1", port: 1, groups: 123 as unknown as string }, () => {});
    } catch (e) {
      caught = e;
    } finally {
      // Defensive: if validation ever stops throwing, the returned socket
      // would attempt to connect to port 1 and emit an unhandled error.
      socket?.on("error", () => {});
      socket?.destroy();
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect(caught.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(String(caught.message)).toContain("options.groups");
  });

  it("Bun.connect with unknown group name surfaces a BoringSSL error", async () => {
    const { server, port } = await listenLocal({ key, cert });
    try {
      let caught: any;
      try {
        // Listener.zig's create_bun_socket_error_t switch throws synchronously
        // when SSL_CTX construction fails (invalid groups/ciphers). The error
        // rejects the connect() Promise before any socket handler runs, so a
        // socket.error assertion would be unreachable here. Same path that
        // the Bun.listen test below relies on.
        await Bun.connect({
          hostname: "127.0.0.1",
          port,
          tls: { groups: "DEFINITELY_NOT_A_REAL_GROUP_NAME" },
          socket: {
            open(s) {
              s.end();
            },
            error() {},
            close() {},
            data() {},
          },
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught.code).toBe("ERR_BORINGSSL");
      expect(String(caught.message)).toContain("Invalid TLS groups");
    } finally {
      server.close();
    }
  });

  it("tls.connect with unknown group name surfaces error via socket.on('error')", async () => {
    const { server, port } = await listenLocal({ key, cert });
    try {
      const err = await new Promise<any>(resolve => {
        const s = tls.connect(
          {
            host: "127.0.0.1",
            port,
            ca,
            servername: "agent1",
            groups: "DEFINITELY_NOT_A_REAL_GROUP_NAME",
          },
          () => {
            s.end();
            resolve(null);
          },
        );
        s.on("error", resolve);
      });
      // The SSL_CTX construction failure now reaches the socket's error
      // event instead of escaping synchronously from kConnectTcp.
      expect(err).toBeDefined();
      expect(err).not.toBeNull();
      expect(err.code).toBe("ERR_BORINGSSL");
      expect(String(err.message)).toContain("Invalid TLS groups");
    } finally {
      server.close();
    }
  });

  it("tlsSocket.getSharedGroup() returns the negotiated group name", async () => {
    const { server, port } = await listenLocal({ key, cert });
    try {
      const group = await new Promise<string | null>((resolve, reject) => {
        const s = tls.connect({ host: "127.0.0.1", port, ca, servername: "agent1" }, () => {
          const g = s.getSharedGroup?.();
          s.end();
          resolve(g ?? null);
        });
        s.on("error", reject);
      });
      // Default Bun list puts MLKEM hybrid first; both endpoints support it
      // (we control both), so the negotiated group is X25519MLKEM768.
      expect(group).toBe("X25519MLKEM768");
    } finally {
      server.close();
    }
  });

  it("tlsSocket.getSharedGroup() reflects an explicit override", async () => {
    const { server, port } = await listenLocal({ key, cert });
    try {
      const group = await new Promise<string | null>((resolve, reject) => {
        const s = tls.connect(
          { host: "127.0.0.1", port, ca, servername: "agent1", groups: "X25519:P-256:P-384" },
          () => {
            const g = s.getSharedGroup?.();
            s.end();
            resolve(g ?? null);
          },
        );
        s.on("error", reject);
      });
      // Client asked for classical-only. The BoringSSL default for the
      // server (inherited via the buntls thunk's `groups` from this test's
      // NO-`groups` server config, which is BUN_DEFAULT) overlaps on
      // X25519, which is the natural fastest pick.
      expect(group).toBe("X25519");
    } finally {
      server.close();
    }
  });

  it("tls.createServer accepts the `groups` option without throwing", () => {
    const server = tls.createServer({ key, cert, groups: "X25519MLKEM768:X25519:P-256:P-384" });
    server.close();
  });

  it("client groups override prevents handshake when server only supports a disjoint set", async () => {
    // Server forced to PQ-only; client forced to classical-only. No shared
    // group, handshake must fail. Validates that BOTH client and server
    // honor the `groups` option (otherwise the BUN_DEFAULT floor would
    // bridge them and the handshake would succeed).
    const { server, port } = await listenLocal({ key, cert, groups: "X25519MLKEM768" });
    try {
      const err: any = await new Promise(resolve => {
        const s = tls.connect(
          { host: "127.0.0.1", port, ca, servername: "agent1", groups: "P-256:P-384" },
          () => {
            s.end();
            resolve(undefined);
          },
        );
        s.on("error", resolve);
      });
      expect(err).toBeDefined();
      // Tighten beyond `.toBeDefined()`: the failure must look like a TLS
      // handshake/SSL error, not a generic ECONNRESET/timeout that would
      // happen for unrelated reasons.
      const codeOrMsg = String(err?.code ?? "") + " " + String(err?.message ?? "");
      expect(/SSL|HANDSHAKE|handshake|shared|alert|TLS/i.test(codeOrMsg)).toBe(true);
    } finally {
      server.close();
    }
  });

  it("`groups: \"\"` empty-string sentinel differs from `groups: undefined`", async () => {
    // Tri-state semantics: NULL applies Bun's PQ default; "" inherits
    // BoringSSL's compile-time default (which excludes PQ today, but may
    // include it in the future as upstream BoringSSL evolves).
    //
    // Compare the negotiated group between an empty-string client and a
    // default client against the same server. The two must differ today
    // (empty string skips Bun's PQ-first list). Hard-coding the group name
    // would break when BoringSSL upstream adds MLKEM to its compile-time
    // default; comparing the two sentinels keeps the test robust to that.
    const connectGetGroup = async (port: number, opts: Record<string, unknown>) =>
      await new Promise<string | null>((resolve, reject) => {
        const s = tls.connect(
          { host: "127.0.0.1", port, ca, servername: "agent1", ...opts },
          () => {
            const g = s.getSharedGroup?.();
            s.end();
            resolve(g ?? null);
          },
        );
        s.on("error", reject);
      });

    // Server uses Bun's PQ-friendly default (no `groups` option), so it is
    // willing to negotiate either MLKEM or classical. The client sentinel is
    // the only thing varying between the two connect calls.
    const { server, port } = await listenLocal({ key, cert });
    try {
      const groupEmpty = await connectGetGroup(port, { groups: "" });
      const groupDefault = await connectGetGroup(port, {});
      expect(groupEmpty).not.toBeNull();
      expect(groupDefault).not.toBeNull();
      // Default client offers MLKEM first (Bun default); empty-string client
      // skips Bun's default and offers BoringSSL's compile-time list, which
      // currently excludes PQ. Server picks MLKEM for the default client and
      // a classical group for the empty-string client. If BoringSSL ever
      // adds MLKEM to its compile-time default, both sides will pick MLKEM
      // and this assertion will need revisiting.
      expect(groupEmpty).not.toBe(groupDefault);
    } finally {
      server.close();
    }
  });

  it("`ecdhCurve: \"auto\"` Node-compat normalizes to Bun PQ default", async () => {
    // Node documents `ecdhCurve: "auto"` for automatic curve selection.
    // BoringSSL's set1_groups_list rejects the literal string "auto", so
    // SSLConfig.fromGenerated normalizes it to NULL (apply Bun PQ default).
    // Both ends "auto" must therefore negotiate via the Bun default
    // (X25519MLKEM768 first).
    const { server, port } = await listenLocal({ key, cert, ecdhCurve: "auto" });
    try {
      const group = await new Promise<string | null>((resolve, reject) => {
        const s = tls.connect(
          { host: "127.0.0.1", port, ca, servername: "agent1", ecdhCurve: "auto" },
          () => {
            const g = s.getSharedGroup?.();
            s.end();
            resolve(g ?? null);
          },
        );
        s.on("error", reject);
      });
      expect(group).toBe("X25519MLKEM768");
    } finally {
      server.close();
    }
  });

  it("Bun.listen with invalid groups surfaces ERR_BORINGSSL", async () => {
    // Server-side path: connectInner's listen() arm of the
    // create_bun_socket_error_t switch must surface invalid_groups as
    // ERR_BORINGSSL (not the generic "Failed to listen").
    let caught: any;
    try {
      const listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { key, cert, groups: "DEFINITELY_NOT_A_REAL_GROUP_NAME" },
        socket: { open() {}, close() {}, data() {} },
      });
      listener.stop();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe("ERR_BORINGSSL");
    expect(String(caught.message)).toContain("Invalid TLS groups");
  });

  it("groups string with embedded NUL is rejected at validation (tls.connect, JS-side guard)", () => {
    // Defense against silent truncation: a NUL inside the groups string
    // would let BoringSSL see only the prefix, downgrading the offered list
    // without surfacing any error.
    let caught: any;
    let socket: tls.TLSSocket | undefined;
    try {
      socket = tls.connect({
        host: "127.0.0.1",
        port: 1,
        groups: "X25519\u0000:GARBAGE",
      });
    } catch (e) {
      caught = e;
    } finally {
      socket?.on("error", () => {});
      socket?.destroy();
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(String(caught.message)).toContain("NUL");
    expect(String(caught.message)).toContain("options.groups");
  });

  it("groups string with embedded NUL is rejected at the Zig boundary (Bun.connect)", async () => {
    // Same defense as the tls.connect test, but exercising the Bun-native
    // path that goes through SSLConfig.fromGenerated in Zig (skipping the
    // JS-side TLSSocket constructor guard). Must produce the same
    // ERR_INVALID_ARG_VALUE code and "options.groups" prefix as the JS
    // path so a user catching the error sees one consistent shape.
    let caught: any;
    try {
      await Bun.connect({
        hostname: "cloudflare.com",
        port: 443,
        tls: { groups: "X25519\u0000:GARBAGE" },
        socket: {
          open(s) {
            s.end();
          },
          error() {},
          close() {},
          data() {},
        },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(String(caught.message)).toContain("NUL");
    expect(String(caught.message)).toContain("options.groups");
  });
});
