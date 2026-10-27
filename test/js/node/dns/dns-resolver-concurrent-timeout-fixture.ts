// 32 queries get an instant answer and 8 more are never answered, which must
// ETIMEOUT: the answers to the others must not disarm the resolver's timer.
import dns from "node:dns";
import dgram from "node:dgram";

const srv = dgram.createSocket("udp4");
srv.on("message", (msg, rinfo) => {
  // qname: first label starts at offset 12, length at byte 12
  const first = msg.subarray(13, 13 + msg[12]).toString();
  if (first === "silent") return; // never answer these

  let off = 12;
  while (msg[off] !== 0) off += msg[off] + 1;
  const question = msg.subarray(12, off + 5);
  const reply = Buffer.concat([
    Buffer.from([msg[0], msg[1], 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0]),
    question,
    Buffer.from([0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 7]),
  ]);
  srv.send(reply, rinfo.port, rinfo.address);
});

srv.bind(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const R = new dns.promises.Resolver({ timeout: 1000, tries: 1 });
  R.setServers([`127.0.0.1:${port}`]);

  let ok = 0;
  const errCodes: string[] = [];
  const ps: Promise<void>[] = [];
  for (let i = 0; i < 32; i++) {
    ps.push(
      R.resolve4(`ok.a${i}.test`).then(
        () => void ok++,
        e => void errCodes.push(e.code),
      ),
    );
  }
  for (let i = 0; i < 8; i++) {
    ps.push(
      R.resolve4(`silent.a${i}.test`).then(
        () => void ok++,
        e => void errCodes.push(e.code),
      ),
    );
  }

  Promise.allSettled(ps).then(() => {
    console.log(JSON.stringify({ ok, errCodes: errCodes.sort() }));
    srv.close();
    R.cancel();
  });
});
