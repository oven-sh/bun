// Calls every node:http2 entry point that takes session options, with values Node.js rejects
// and with a few it accepts, and prints how each call ends. Run under Node.js and under Bun:
// the output must be identical.
const http2 = require("node:http2");
const net = require("node:net");
const { Duplex } = require("node:stream");
const { promisify } = require("node:util");

function duplex() {
  return new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      callback();
    },
  });
}

function describeError(e) {
  return `${e.name} [${e.code}]: ${e.message}`;
}

function outcome(call) {
  let created;
  try {
    created = call();
  } catch (e) {
    return describeError(e);
  }
  // A session whose socket is still connecting. Nothing here needs the connection.
  if (typeof created.destroy === "function") {
    created.on("error", () => {});
    created.destroy();
  }
  return "no throw";
}

// node runs connect() inside the Promise executor, so a rejected option rejects the promise.
const promisifiedConnect = promisify(http2.connect);
function promisifiedOutcome(url, options) {
  let promise;
  try {
    promise = promisifiedConnect(url, options);
  } catch (e) {
    return `throws ${describeError(e)}`;
  }
  return promise.then(
    session => {
      session.destroy();
      return "resolves";
    },
    e => `rejects with ${describeError(e)}`,
  );
}

// The calls that do not throw dial this port. Their sessions are destroyed at once, but a
// connect that is already queued can still arrive. It must arrive at a port this process owns.
const sink = net.createServer(socket => socket.destroy());
sink.listen(0, "127.0.0.1", async () => {
  const { port } = sink.address();
  const entryPoints = {
    "connect(http)": options => http2.connect(`http://127.0.0.1:${port}`, options),
    "connect(https)": options => http2.connect(`https://127.0.0.1:${port}`, options),
    "connect(createConnection)": options =>
      http2.connect(`https://127.0.0.1:${port}`, { ...options, createConnection: duplex }),
    "createServer": options => http2.createServer(options),
    "createSecureServer": options => http2.createSecureServer(options),
    "performServerHandshake": options => http2.performServerHandshake(duplex(), options),
  };
  const everyEntryPoint = Object.keys(entryPoints);
  // The entry points where node runs initializeOptions(). A connect() over http or over
  // createConnection skips it: the { maxSessionInvalidFrames: -1 } row shows that once.
  const initializeOptionsCallers = ["connect(https)", "createServer", "createSecureServer", "performServerHandshake"];

  // [label, options, entry points (default: all of them)]
  const rows = [
    ['{ strictSingleValueFields: "yes" }', { strictSingleValueFields: "yes" }],
    ["{ strictSingleValueFields: 0 }", { strictSingleValueFields: 0 }],
    ["{ strictSingleValueFields: null }", { strictSingleValueFields: null }],
    ["{ strictSingleValueFields: false }", { strictSingleValueFields: false }],
    ["{ strictSingleValueFields: undefined }", { strictSingleValueFields: undefined }],

    ["{ maxSessionInvalidFrames: -1 }", { maxSessionInvalidFrames: -1 }],
    ["{ maxSessionInvalidFrames: 2 ** 32 }", { maxSessionInvalidFrames: 2 ** 32 }, initializeOptionsCallers],
    ['{ maxSessionInvalidFrames: "1" }', { maxSessionInvalidFrames: "1" }, initializeOptionsCallers],
    ["{ maxSessionRejectedStreams: -1 }", { maxSessionRejectedStreams: -1 }, initializeOptionsCallers],
    ["{ unknownProtocolTimeout: -1 }", { unknownProtocolTimeout: -1 }, initializeOptionsCallers],
    [
      "{ maxSessionInvalidFrames: 2 ** 32 - 1, maxSessionRejectedStreams: 2 ** 32 - 1, unknownProtocolTimeout: 0 }",
      { maxSessionInvalidFrames: 2 ** 32 - 1, maxSessionRejectedStreams: 2 ** 32 - 1, unknownProtocolTimeout: 0 },
      initializeOptionsCallers,
    ],

    ["{ settings: 1 }", { settings: 1 }, initializeOptionsCallers],
    ["{ settings: null }", { settings: null }, initializeOptionsCallers],
    ["{ settings: [] }", { settings: [] }, initializeOptionsCallers],
    ["{ settings: function () {} }", { settings: function () {} }, initializeOptionsCallers],

    // Two rejected values: the check that runs first decides the error.
    [
      '{ remoteCustomSettings: "x", strictSingleValueFields: "yes" }',
      { remoteCustomSettings: "x", strictSingleValueFields: "yes" },
    ],
    [
      "{ remoteCustomSettings: [11 ids], maxSessionInvalidFrames: -1 }",
      { remoteCustomSettings: Array.from({ length: 11 }, (_, i) => 0x100 + i), maxSessionInvalidFrames: -1 },
    ],
    [
      "{ settings: 1, maxSessionInvalidFrames: -1 }",
      { settings: 1, maxSessionInvalidFrames: -1 },
      initializeOptionsCallers,
    ],
    [
      "{ maxSessionInvalidFrames: -1, maxSessionRejectedStreams: -1 }",
      { maxSessionInvalidFrames: -1, maxSessionRejectedStreams: -1 },
      initializeOptionsCallers,
    ],
    [
      "{ maxSessionRejectedStreams: -1, unknownProtocolTimeout: -1 }",
      { maxSessionRejectedStreams: -1, unknownProtocolTimeout: -1 },
      initializeOptionsCallers,
    ],
    [
      '{ unknownProtocolTimeout: -1, strictSingleValueFields: "yes" }',
      { unknownProtocolTimeout: -1, strictSingleValueFields: "yes" },
    ],
  ];

  const lines = [];
  // Calls that end the same way share one line.
  function print(label, outcomes) {
    lines.push(label);
    const byOutcome = new Map();
    for (const [name, result] of outcomes) {
      if (!byOutcome.has(result)) byOutcome.set(result, []);
      byOutcome.get(result).push(name);
    }
    for (const [result, names] of byOutcome) {
      lines.push(`  ${result}`);
      lines.push(`    ${names.length === everyEntryPoint.length ? "every entry point" : names.join(", ")}`);
    }
  }

  for (const [label, options, names = everyEntryPoint] of rows) {
    print(
      label,
      names.map(name => [name, outcome(() => entryPoints[name](options))]),
    );
  }

  const authority = { hostname: "127.0.0.1", port };
  let seenByCreateConnection;
  http2
    .connect(`http://127.0.0.1:${port}`, {
      createConnection(url, options) {
        seenByCreateConnection = options.strictSingleValueFields;
        return duplex();
      },
    })
    .destroy();
  print("other calls", [
    [
      'connect("not a url", { strictSingleValueFields: "yes" })',
      outcome(() => http2.connect("not a url", { strictSingleValueFields: "yes" })),
    ],
    ["connect(function authority() {})", outcome(() => http2.connect(function authority() {}))],
    [
      'connect({ hostname, port }, { protocol: "https:", maxSessionInvalidFrames: -1 })',
      outcome(() => http2.connect(authority, { protocol: "https:", maxSessionInvalidFrames: -1 })),
    ],
    [
      "connect({ hostname, port }, { maxSessionInvalidFrames: -1 })",
      outcome(() => http2.connect(authority, { maxSessionInvalidFrames: -1 })),
    ],
    [
      'connect({ hostname, port }, { protocol: "http:", maxSessionInvalidFrames: -1 })',
      outcome(() => http2.connect(authority, { protocol: "http:", maxSessionInvalidFrames: -1 })),
    ],
    ["createSecureServer([])", outcome(() => http2.createSecureServer([]))],
    [
      "performServerHandshake(duplex, function options() {})",
      outcome(() => http2.performServerHandshake(duplex(), function options() {})),
    ],
    ["options.strictSingleValueFields that createConnection() receives", String(seenByCreateConnection)],
    [
      'promisify(connect)(http url, { strictSingleValueFields: "yes" })',
      await promisifiedOutcome(`http://127.0.0.1:${port}`, { strictSingleValueFields: "yes" }),
    ],
    [
      "promisify(connect)(https url, { maxSessionInvalidFrames: -1 })",
      await promisifiedOutcome(`https://127.0.0.1:${port}`, { maxSessionInvalidFrames: -1 }),
    ],
  ]);

  console.log(lines.join("\n"));
  // Stay open for the connects that are still queued, but do not keep the process alive.
  sink.unref();
});
