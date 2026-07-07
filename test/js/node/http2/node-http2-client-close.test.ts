import { test, expect, describe } from "bun:test";
import http2 from "node:http2";
import net from "node:net";

// close(code) event contract (verified against Node v26.3.0):
//   NO_ERROR / CANCEL  -> 'end', 'close'             (documented 'error' exemption)
//   any other code     -> 'error', 'close'           (no 'end': the body was killed by RST_STREAM)
describe("ClientHttp2Stream.close(code) event sequence after data", () => {
  // Raw h2c server: replies 200 + one DATA frame and never sends END_STREAM, so the only way the
  // stream ends is via the client's close(code).
  function rawH2Server() {
    const F = { DATA: 0, HEADERS: 1, SETTINGS: 4, PING: 6 };
    const frame = (t: number, fl: number, sid: number, p: Buffer) => {
      const b = Buffer.alloc(9 + p.length);
      b.writeUIntBE(p.length, 0, 3);
      b[3] = t;
      b[4] = fl;
      b.writeUInt32BE(sid >>> 0, 5);
      p.copy(b, 9);
      return b;
    };
    const hp = (h: [string, string][]) =>
      Buffer.concat(
        h.map(([k, v]) =>
          Buffer.concat([Buffer.from([0x10, k.length]), Buffer.from(k), Buffer.from([v.length]), Buffer.from(v)]),
        ),
      );
    const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
    return net.createServer(s => {
      let buf = Buffer.alloc(0);
      let pre = false;
      s.on("error", () => {});
      s.on("data", d => {
        buf = Buffer.concat([buf, d]);
        if (!pre) {
          if (buf.length < PREFACE.length) return;
          pre = true;
          buf = buf.slice(PREFACE.length);
          s.write(frame(F.SETTINGS, 0, 0, Buffer.alloc(0)));
        }
        while (buf.length >= 9) {
          const len = buf.readUIntBE(0, 3);
          if (buf.length < 9 + len) break;
          const t = buf[3];
          const fl = buf[4];
          const sid = buf.readUInt32BE(5) & 0x7fffffff;
          const pay = buf.slice(9, 9 + len);
          buf = buf.slice(9 + len);
          if (t === F.SETTINGS && !(fl & 1)) s.write(frame(F.SETTINGS, 1, 0, Buffer.alloc(0)));
          else if (t === F.PING && !(fl & 1)) s.write(frame(F.PING, 1, 0, pay));
          else if (t === F.HEADERS) {
            s.write(frame(F.HEADERS, 0x4, sid, hp([[":status", "200"]])));
            s.write(frame(F.DATA, 0, sid, Buffer.alloc(600, 0x2e)));
          }
        }
      });
    });
  }

  async function collectEvents(port: number, code: number) {
    const events: string[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();
    const ses = http2.connect(`http://127.0.0.1:${port}`);
    ses.on("error", reject);
    ses.on("close", () => resolve(events));
    ses.on("remoteSettings", () => {
      const st = ses.request({ ":path": "/" }, { endStream: true });
      let gotData = false;
      st.on("response", () => events.push("response"));
      st.on("data", () => {
        if (!gotData) {
          gotData = true;
          events.push("data");
          st.close(code);
        }
      });
      st.on("end", () => events.push("end"));
      st.on("error", e => events.push("error:" + (e as NodeJS.ErrnoException).code));
      st.on("close", () => {
        events.push("close:" + st.rstCode);
        ses.destroy();
      });
    });
    return promise;
  }

  test.each([
    [http2.constants.NGHTTP2_NO_ERROR, ["response", "data", "end", "close:0"]],
    [http2.constants.NGHTTP2_CANCEL, ["response", "data", "end", "close:8"]],
    [http2.constants.NGHTTP2_INTERNAL_ERROR, ["response", "data", "error:ERR_HTTP2_STREAM_ERROR", "close:2"]],
    [http2.constants.NGHTTP2_ENHANCE_YOUR_CALM, ["response", "data", "error:ERR_HTTP2_STREAM_ERROR", "close:11"]],
  ])("close(%p)", async (code, expected) => {
    const srv = rawH2Server();
    await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
    try {
      const events = await collectEvents((srv.address() as net.AddressInfo).port, code);
      expect(events).toEqual(expected);
    } finally {
      srv.close();
    }
  });
});
