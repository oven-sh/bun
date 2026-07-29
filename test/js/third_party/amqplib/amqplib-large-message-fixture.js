// Minimal in-process AMQP 0.9.1 server that speaks enough of the protocol for
// amqplib to connect, open a channel, declare/purge a queue, publish a message,
// and retrieve it with Basic.Get. Uses amqplib's own frame codec so the wire
// format is identical to what a real RabbitMQ client sees.
//
// Exercises both directions over a real TCP socket at the default 4 KiB frame
// size, so payloads larger than that are split across many body frames and go
// through amqplib's Mux (objectMode PassThrough -> net.Socket) on the send side
// and the 'readable' / socket.read() loop on the receive side.

const net = require("net");
const crypto = require("crypto");
const defs = require("amqplib/lib/defs");
const frame = require("amqplib/lib/frame");
const amqplib = require("amqplib");

const FRAME_MAX = 4096;

function fakeServer(queue) {
  const server = net.createServer(sock => {
    let rest = Buffer.alloc(0);
    let sawHeader = false;
    let expectBody = 0;
    let body = [];

    function sendMethod(id, channel, fields) {
      sock.write(defs.encodeMethod(id, channel, fields));
    }
    function sendContent(channel, id, fields, content) {
      sock.write(defs.encodeMethod(id, channel, fields));
      sock.write(defs.encodeProperties(defs.BasicProperties, channel, content.length, {}));
      const maxBody = FRAME_MAX - defs.FRAME_OVERHEAD;
      for (let off = 0; off < content.length; off += maxBody) {
        sock.write(frame.makeBodyFrame(channel, content.subarray(off, off + maxBody)));
      }
    }

    function accept(f) {
      const ch = f.channel;
      switch (f.id) {
        case defs.ConnectionStartOk:
          return sendMethod(defs.ConnectionTune, 0, { channelMax: 0, frameMax: FRAME_MAX, heartbeat: 0 });
        case defs.ConnectionTuneOk:
          return;
        case defs.ConnectionOpen:
          return sendMethod(defs.ConnectionOpenOk, 0, { knownHosts: "" });
        case defs.ConnectionClose:
          sendMethod(defs.ConnectionCloseOk, 0, {});
          return sock.end();
        case defs.ChannelOpen:
          return sendMethod(defs.ChannelOpenOk, ch, { channelId: Buffer.from("") });
        case defs.ChannelClose:
          return sendMethod(defs.ChannelCloseOk, ch, {});
        case defs.QueueDeclare:
          return sendMethod(defs.QueueDeclareOk, ch, { queue: f.fields.queue, messageCount: 0, consumerCount: 0 });
        case defs.QueuePurge:
          queue.content = null;
          return sendMethod(defs.QueuePurgeOk, ch, { messageCount: 0 });
        case defs.BasicPublish:
          expectBody = -1;
          body = [];
          return;
        case defs.BasicGet:
          if (queue.content) {
            return sendContent(
              ch,
              defs.BasicGetOk,
              {
                deliveryTag: 1,
                redelivered: false,
                exchange: "",
                routingKey: f.fields.queue,
                messageCount: 0,
              },
              queue.content,
            );
          }
          return sendMethod(defs.BasicGetEmpty, ch, { clusterId: "" });
        case defs.BasicProperties:
          expectBody = f.size;
          if (expectBody === 0) queue.content = Buffer.alloc(0);
          return;
        case undefined:
          if (f.content) {
            body.push(f.content);
            const got = body.reduce((a, b) => a + b.length, 0);
            if (got >= expectBody) {
              queue.content = Buffer.concat(body);
              expectBody = 0;
              body = [];
            }
          }
          return;
        default:
          throw new Error(`unhandled method ${defs.info(f.id).name}`);
      }
    }

    function go() {
      let inc;
      while ((inc = sock.read()) !== null) rest = Buffer.concat([rest, inc]);
      if (!sawHeader) {
        if (rest.length < 8) return;
        sawHeader = true;
        rest = rest.subarray(8);
        sendMethod(defs.ConnectionStart, 0, {
          versionMajor: 0,
          versionMinor: 9,
          serverProperties: {},
          mechanisms: Buffer.from("PLAIN"),
          locales: Buffer.from("en_US"),
        });
      }
      let parsed;
      while ((parsed = frame.parseFrame(rest, FRAME_MAX))) {
        rest = parsed.rest;
        accept(frame.decodeFrame(parsed));
      }
    }
    sock.on("readable", go);
    sock.on("error", () => {});
  });
  return server;
}

async function roundtrip(port, size) {
  const expected = crypto.randomBytes(size);

  {
    const conn = await amqplib.connect(`amqp://127.0.0.1:${port}`);
    const channel = await conn.createChannel();
    await channel.assertQueue("q");
    await channel.purgeQueue("q");
    channel.sendToQueue("q", expected);
    await channel.close();
    await conn.close();
  }

  {
    const conn = await amqplib.connect(`amqp://127.0.0.1:${port}`);
    const channel = await conn.createChannel();
    const msg = await channel.get("q");
    await channel.close();
    await conn.close();
    if (!msg) throw new Error(`size=${size}: no message`);
    if (msg.content.length !== size) throw new Error(`size=${size}: length ${msg.content.length} != ${size}`);
    if (!msg.content.equals(expected)) throw new Error(`size=${size}: content mismatch`);
  }
}

(async () => {
  const queue = { content: null };
  const server = fakeServer(queue);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    for (const size of [100, 200_000]) {
      await roundtrip(port, size);
      console.log(`OK ${size}`);
    }
  } finally {
    server.close();
  }
})();
