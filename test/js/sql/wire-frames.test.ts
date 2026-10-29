// Spec-compliance self-test for the wire-frames builders. The fault-injection
// tests in this directory hand-roll Postgres/MySQL protocol frames; if a
// builder's byte layout ever drifts from what Bun's own parser accepts, this
// file goes red before any of the dependent tests do.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { tls as localhostTls } from "harness";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlLenencInt,
  mysqlOkPacket,
  mysqlReadPackets,
  pgAuthenticationOk,
  pgAuthenticationSASLContinue,
  pgAuthenticationSASLFinal,
  pgBackendKeyData,
  pgBind,
  type PgBindFrame,
  pgCancelRequest,
  pgCloseComplete,
  pgCopyBothResponse,
  pgCopyInResponse,
  pgCopyOutResponse,
  pgDecodeBind,
  pgDescribe,
  pgErrorResponse,
  pgExecute,
  pgMinimalReadyServer,
  pgNoData,
  pgParse,
  pgParseSASLInitialResponse,
  pgParseStartupMessage,
  pgReadyForQuery,
  pgScramServer,
  pgSync,
} from "./wire-frames";

test("mysqlLenencInt encodes per page_protocol_basic_dt_integers.html", () => {
  expect(mysqlLenencInt(0)).toEqual(Buffer.from([0x00]));
  expect(mysqlLenencInt(250)).toEqual(Buffer.from([0xfa]));
  expect(mysqlLenencInt(251)).toEqual(Buffer.from([0xfc, 0xfb, 0x00]));
  expect(mysqlLenencInt(0xffff)).toEqual(Buffer.from([0xfc, 0xff, 0xff]));
  expect(mysqlLenencInt(0x1_0000)).toEqual(Buffer.from([0xfd, 0x00, 0x00, 0x01]));
  expect(mysqlLenencInt(0xff_ffffn)).toEqual(Buffer.from([0xfd, 0xff, 0xff, 0xff]));
  expect(mysqlLenencInt(0x1_00_0000n)).toEqual(Buffer.from([0xfe, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]));
});

test("pgErrorResponse encodes per §55.7", () => {
  expect(pgErrorResponse({ S: "FATAL", C: "57P03", M: "x" })).toEqual(
    Buffer.from("E\x00\x00\x00\x16SFATAL\x00C57P03\x00Mx\x00\x00", "binary"),
  );
});

test("frontend message builders encode per §55.7", () => {
  expect(pgParse("s1", "select $1", [23])).toEqual(
    Buffer.from("P\x00\x00\x00\x17s1\x00select $1\x00\x00\x01\x00\x00\x00\x17", "binary"),
  );
  expect(pgDescribe("S", "s1")).toEqual(Buffer.from("D\x00\x00\x00\x08Ss1\x00", "binary"));
  expect(
    pgBind({
      statement: "s1",
      paramFormats: [1, 0],
      params: [Buffer.from([0, 0, 0, 42]), null],
      resultFormats: [1],
    }),
  ).toEqual(
    Buffer.from(
      "B\x00\x00\x00\x20" + // length: 4 + 28 bytes of body
        "\x00" + // portal ""
        "s1\x00" +
        "\x00\x02\x00\x01\x00\x00" + // two parameter format codes: binary, text
        "\x00\x02" + // two parameter values
        "\x00\x00\x00\x04\x00\x00\x00\x2a" + // 4 bytes
        "\xff\xff\xff\xff" + // NULL
        "\x00\x01\x00\x01", // one result format code: binary
      "binary",
    ),
  );
  expect(pgExecute()).toEqual(Buffer.from("E\x00\x00\x00\x09\x00\x00\x00\x00\x00", "binary"));
  expect(pgSync()).toEqual(Buffer.from("S\x00\x00\x00\x04", "binary"));
  expect(pgCancelRequest(1, 2)).toEqual(
    Buffer.from("\x00\x00\x00\x10\x04\xd2\x16\x2e\x00\x00\x00\x01\x00\x00\x00\x02", "binary"),
  );
});

test("backend message builders encode per §55.7", () => {
  expect(pgAuthenticationSASLContinue("r=x")).toEqual(Buffer.from("R\x00\x00\x00\x0b\x00\x00\x00\x0br=x", "binary"));
  expect(pgAuthenticationSASLFinal("v=x")).toEqual(Buffer.from("R\x00\x00\x00\x0b\x00\x00\x00\x0cv=x", "binary"));
  expect(pgBackendKeyData(1, 2)).toEqual(Buffer.from("K\x00\x00\x00\x0c\x00\x00\x00\x01\x00\x00\x00\x02", "binary"));
  expect(pgCloseComplete()).toEqual(Buffer.from("3\x00\x00\x00\x04", "binary"));
  expect(pgNoData()).toEqual(Buffer.from("n\x00\x00\x00\x04", "binary"));
  const copyBody = "\x00\x00\x00\x0b\x01\x00\x02\x00\x01\x00\x01";
  expect(pgCopyInResponse([1, 1], 1)).toEqual(Buffer.from("G" + copyBody, "binary"));
  expect(pgCopyOutResponse([1, 1], 1)).toEqual(Buffer.from("H" + copyBody, "binary"));
  expect(pgCopyBothResponse([1, 1], 1)).toEqual(Buffer.from("W" + copyBody, "binary"));
});

test("frontend message parsers are the inverse of what a client writes", () => {
  const bind: Required<PgBindFrame> = {
    portal: "",
    statement: "s1",
    paramFormats: [1, 0, 0],
    params: [Buffer.from([0, 0, 0, 42]), null, Buffer.alloc(0)],
    resultFormats: [1, 0],
  };
  expect(pgDecodeBind(pgBind(bind).subarray(5))).toEqual(bind);

  const startup = Buffer.from("\x00\x00\x00\x1c\x00\x03\x00\x00user\x00u\x00database\x00db\x00\x00", "binary");
  expect(pgParseStartupMessage(startup.subarray(0, startup.length - 1))).toBeNull();
  expect(pgParseStartupMessage(Buffer.concat([startup, Buffer.from("p")]))).toEqual({
    params: { user: "u", database: "db" },
    rest: Buffer.from("p"),
  });

  expect(pgParseSASLInitialResponse(Buffer.from("SCRAM-SHA-256\x00\x00\x00\x00\x08n,,n=,r=x", "binary"))).toEqual({
    mechanism: "SCRAM-SHA-256",
    clientFirstMessage: "n,,n=,r=",
  });
});

test.each([
  ["plaintext", undefined, "disable"],
  ["TLS", localhostTls, "require"],
] as const)("postgres: pgScramServer checks the proof Bun sends over %s", async (_, tls, sslmode) => {
  await using server = await pgScramServer({ password: "pässword", tls });
  const login = async (password: string) => {
    await using db = new SQL({
      url: `postgres://u@127.0.0.1:${server.port}/db?sslmode=${sslmode}`,
      password,
      max: 1,
    });
    return db.connect().then(
      () => "CONNECTED",
      error => error.errno,
    );
  };
  expect(await login("pässword")).toBe("CONNECTED");
  expect(await login("password")).toBe("28P01");
  expect(server.exchanges.map(({ startup, initial, proofOk }) => [startup.user, initial?.mechanism, proofOk])).toEqual([
    ["u", "SCRAM-SHA-256", true],
    ["u", "SCRAM-SHA-256", false],
  ]);
});

test("postgres: pgAuthenticationOk + pgReadyForQuery are accepted by Bun's parser", async () => {
  // Minimal Postgres mock: on the startup packet, reply AuthenticationOk +
  // ReadyForQuery. connect() resolving proves both frames decode.
  const { port, server } = await listeningServer(socket => {
    socket.once("data", () => {
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
    });
  });
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1 });
  try {
    await expect(db.connect()).resolves.toBeDefined();
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});

test("postgres: pgMinimalReadyServer satisfies connect()", async () => {
  const { port, server } = await pgMinimalReadyServer();
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1 });
  try {
    await expect(db.connect()).resolves.toBeDefined();
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});

test("mysql: mysqlHandshakeV10 + mysqlOkPacket are accepted by Bun's parser", async () => {
  // Minimal MySQL mock: send HandshakeV10 on accept, reply OK to the
  // HandshakeResponse41. connect() resolving proves both frames decode.
  const { port, server } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.write(mysqlHandshakeV10());
    socket.on("data", (chunk: Buffer) => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(seq + 1));
        } else {
          mysqlAckSessionSetup(socket, payload);
        }
      });
    });
    socket.on("error", () => {});
  });
  // Empty password so the mysql_native_password scramble is empty and the mock
  // can OK it without validating.
  const db = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
  try {
    await expect(db.connect()).resolves.toBeDefined();
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});
