import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

const date = (iso: string) => new Date(iso);
const hex = (bytes: string) => Buffer.from(bytes, "hex");
const invalidDate = new Date(NaN);
// toEqual() finds two Invalid Dates unequal.
const comparable = (v: unknown) => (v instanceof Date && Number.isNaN(v.getTime()) ? "Invalid Date" : v);

// [column type, [SQL literal, decoded value][]]
const columns: [string, [string, unknown][]][] = [
  [
    "TINYINT",
    [
      ["-128", -128],
      ["127", 127],
    ],
  ],
  ["TINYINT UNSIGNED", [["255", 255]]],
  [
    "BOOLEAN",
    [
      ["TRUE", 1],
      ["FALSE", 0],
    ],
  ],
  [
    "SMALLINT",
    [
      ["-32768", -32768],
      ["32767", 32767],
    ],
  ],
  ["SMALLINT UNSIGNED", [["65535", 65535]]],
  [
    "MEDIUMINT",
    [
      ["-8388608", -8388608],
      ["8388607", 8388607],
    ],
  ],
  ["MEDIUMINT UNSIGNED", [["16777215", 16777215]]],
  [
    "INT",
    [
      ["-2147483648", -2147483648],
      ["2147483647", 2147483647],
    ],
  ],
  ["INT UNSIGNED", [["4294967295", 4294967295]]],
  [
    "BIGINT",
    [
      ["5", 5],
      ["-2147483649", "-2147483649"],
      ["9007199254740993", "9007199254740993"],
      ["-9223372036854775808", "-9223372036854775808"],
    ],
  ],
  [
    "BIGINT UNSIGNED",
    [
      ["5", 5],
      ["4294967296", "4294967296"],
      ["18446744073709551615", "18446744073709551615"],
    ],
  ],
  [
    "DOUBLE",
    [
      ["0.1", 0.1],
      ["-3.141592653589793", -3.141592653589793],
      ["1.7976931348623157e308", Number.MAX_VALUE],
    ],
  ],
  [
    "DECIMAL(20,5)",
    [
      ["123456789012345.12345", "123456789012345.12345"],
      ["-0.00001", "-0.00001"],
      ["0", "0.00000"],
    ],
  ],
  ["DECIMAL(10,0)", [["-42", "-42"]]],
  [
    "DECIMAL(65,30)",
    [
      [
        "12345678901234567890123456789012345.123456789012345678901234567890",
        "12345678901234567890123456789012345.123456789012345678901234567890",
      ],
    ],
  ],
  [
    "YEAR",
    [
      ["1901", 1901],
      ["2155", 2155],
      ["0000", 0],
    ],
  ],
  [
    "DATE",
    [
      ["'2024-02-29'", date("2024-02-29T00:00:00.000Z")],
      ["'1969-12-31'", date("1969-12-31T00:00:00.000Z")],
      ["'0001-01-01'", date("0001-01-01T00:00:00.000Z")],
      ["'9999-12-31'", date("9999-12-31T00:00:00.000Z")],
      ["'0000-00-00'", invalidDate],
    ],
  ],
  [
    "DATETIME",
    [
      ["'2024-06-15 12:34:56'", date("2024-06-15T12:34:56.000Z")],
      ["'2024-06-15 00:00:00'", date("2024-06-15T00:00:00.000Z")],
      ["'1969-12-31 23:59:59'", date("1969-12-31T23:59:59.000Z")],
      ["'0000-00-00 00:00:00'", invalidDate],
    ],
  ],
  ["DATETIME(3)", [["'2024-06-15 12:34:56.789'", date("2024-06-15T12:34:56.789Z")]]],
  [
    "DATETIME(6)",
    [
      ["'2024-06-15 12:34:56.789123'", date("2024-06-15T12:34:56.789Z")],
      ["'1969-12-31 23:59:59.999999'", date("1969-12-31T23:59:59.999Z")],
    ],
  ],
  [
    "TIMESTAMP NULL",
    [
      ["'1970-01-01 00:00:01'", date("1970-01-01T00:00:01.000Z")],
      ["'2038-01-19 03:14:07'", date("2038-01-19T03:14:07.000Z")],
    ],
  ],
  ["TIMESTAMP(6) NULL", [["'2024-06-15 12:34:56.789123'", date("2024-06-15T12:34:56.789Z")]]],
  // A TIME is the server's text: the fraction is as long as the column's precision.
  ...(
    [
      ["TIME", ["12:34:56", "-12:34:56", "838:59:59", "-838:59:59", "00:00:00", "100:00:00", "-00:00:01"]],
      ["TIME(1)", ["01:02:03.4", "00:00:00.0"]],
      ["TIME(2)", ["01:02:03.40", "01:02:03.04"]],
      ["TIME(3)", ["12:34:56.789", "-12:34:56.400", "00:00:00.000", "00:00:00.001", "-00:00:00.001"]],
      ["TIME(4)", ["01:02:03.0400"]],
      ["TIME(5)", ["-01:02:03.00005"]],
      ["TIME(6)", ["12:34:56.789123", "-838:59:58.999999", "00:00:00.000500", "02:03:04.500000", "00:00:00.000000"]],
    ] as const
  ).map(([type, times]): [string, [string, unknown][]] => [type, times.map(time => [`'${time}'`, time])]),
  [
    "BIT(1)",
    [
      ["b'1'", true],
      ["b'0'", false],
    ],
  ],
  ["BIT(8)", [["b'10101010'", hex("aa")]]],
  ["BIT(64)", [["b'1'", hex("0000000000000001")]]],
  [
    "CHAR(10)",
    [
      ["'abc'", "abc"],
      ["''", ""],
      ["'日本語'", "日本語"],
    ],
  ],
  [
    "VARCHAR(300)",
    [
      ["'😀 emoji'", "😀 emoji"],
      ["REPEAT('x', 250)", Buffer.alloc(250, "x").toString()],
      ["REPEAT('x', 251)", Buffer.alloc(251, "x").toString()],
      ["REPEAT('y', 300)", Buffer.alloc(300, "y").toString()],
    ],
  ],
  ["VARCHAR(20) COLLATE utf8mb4_bin", [["'abc'", "abc"]]],
  ["VARCHAR(20) CHARACTER SET latin1", [["'café'", "café"]]],
  ["VARCHAR(20) CHARACTER SET ucs2", [["'café'", "café"]]],
  ["VARCHAR(20) CHARACTER SET utf16", [["'😀x'", "😀x"]]],
  ["VARCHAR(20) CHARACTER SET gbk", [["'中文'", "中文"]]],
  ["VARCHAR(20) CHARACTER SET sjis", [["'日本'", "日本"]]],
  [
    "BINARY(4)",
    [
      ["x'01020304'", hex("01020304")],
      ["x'ff'", hex("ff000000")],
    ],
  ],
  [
    "VARBINARY(20)",
    [
      ["x'00ff10'", hex("00ff10")],
      ["''", hex("")],
    ],
  ],
  ["TINYBLOB", [["x'00ff'", hex("00ff")]]],
  [
    "BLOB",
    [
      ["x'deadbeef'", hex("deadbeef")],
      ["''", hex("")],
    ],
  ],
  ["MEDIUMBLOB", [["x'deadbeef'", hex("deadbeef")]]],
  ["LONGBLOB", [["x'deadbeef'", hex("deadbeef")]]],
  ["TINYTEXT", [["'tt'", "tt"]]],
  [
    "TEXT",
    [
      ["'😀'", "😀"],
      ["''", ""],
    ],
  ],
  ["MEDIUMTEXT", [["'mt'", "mt"]]],
  ["LONGTEXT", [["'lt'", "lt"]]],
  ["TEXT CHARACTER SET latin1", [["'café'", "café"]]],
  [
    "ENUM('a','b','c')",
    [
      ["'b'", "b"],
      ["''", ""],
    ],
  ],
  [
    "SET('x','y','z')",
    [
      ["'x,z'", "x,z"],
      ["''", ""],
    ],
  ],
  [
    "JSON",
    [
      [`'{"a":1,"b":[1,2,3],"c":null}'`, { a: 1, b: [1, 2, 3], c: null }],
      ["'[1,2]'", [1, 2]],
      [`'"str"'`, "str"],
      ["'123'", 123],
      ["'null'", null],
      ["'true'", true],
    ],
  ],
  ["GEOMETRY", [["ST_GeomFromText('POINT(1 2)')", hex("000000000101000000000000000000f03f0000000000000040")]]],
  ["POINT", [["ST_GeomFromText('POINT(1.5 -2.5)')", hex("000000000101000000000000000000f83f00000000000004c0")]]],
];

// [expression, decoded value]
const expressions: [string, unknown][] = [
  ["NULL", null],
  ["1", 1],
  ["TRUE", 1],
  ["'x'", "x"],
  ["x'4142'", hex("4142")],
  ["1.5e0", 1.5],
  ["1/3", "0.3333"],
  ["SUM(1.5)", "1.5"],
  ["AVG(3)", "3.0000"],
  ["COUNT(*)", 1],
  ["CONCAT('a', 1)", "a1"],
  ["9223372036854775807 + 0", "9223372036854775807"],
  ["18446744073709551615", "18446744073709551615"],
  ["CAST(5 AS UNSIGNED)", 5],
  ["CAST(5 AS DECIMAL(5,2))", "5.00"],
  ["CAST(123 AS CHAR)", "123"],
  ["CAST('abc' AS BINARY)", hex("616263")],
  ["CAST('2024-01-02' AS DATE)", date("2024-01-02T00:00:00.000Z")],
  ["CAST('2024-01-02 03:04:05' AS DATETIME)", date("2024-01-02T03:04:05.000Z")],
  ["DATE_FORMAT('2024-01-02', '%Y/%m/%d')", "2024/01/02"],
  ["CAST('01:02:03.456' AS TIME(3))", "01:02:03.456"],
  ["TIMEDIFF('2024-01-01 00:00:00', '2024-01-02 01:02:03.5')", "-25:02:03.5"],
  ["SEC_TO_TIME(3661)", "01:01:01"],
  ["SEC_TO_TIME(3661.25)", "01:01:01.25"],
  ["MAKETIME(1, 2, 3.5)", "01:02:03.5"],
  ["TIME('10:11:12.130000')", "10:11:12.130000"],
  [`JSON_EXTRACT('{"a":[1,2]}', '$.a')`, [1, 2]],
  ["JSON_OBJECT('k', 1)", { k: 1 }],
  ["UNHEX('00112233445566778899aabbccddeeff')", hex("00112233445566778899aabbccddeeff")],
  ["INET6_ATON('::1')", hex("00000000000000000000000000000001")],
];

// [column type, SQL literal, the value's bytes in the binary protocol without their length prefix]
const rawBinary: [string, string, string][] = [
  ["TINYINT", "-2", "fe"],
  ["SMALLINT", "258", "0201"],
  ["YEAR", "2024", "e807"],
  ["MEDIUMINT", "-50", "ceffff"],
  ["INT", "258", "02010000"],
  ["BIGINT", "5000000000", "00f2052a01000000"],
  ["FLOAT", "1.5", "0000c03f"],
  ["DOUBLE", "1.5", "000000000000f83f"],
  ["DECIMAL(5,2)", "1.5", Buffer.from("1.50").toString("hex")],
  ["TIME", "'01:02:03'", "0000000000010203"],
  ["TIME(3)", "'-26:02:03.456'", "010100000002020340f50600"],
  ["TIME", "'00:00:00'", ""],
  ["DATE", "'2024-02-29'", "e807021d"],
  ["DATE", "'0000-00-00'", ""],
  ["DATETIME", "'2024-02-29 01:02:03'", "e807021d010203"],
  ["DATETIME", "'2024-02-29 00:00:00'", "e807021d"],
  ["DATETIME(3)", "'2024-02-29 01:02:03.456'", "e807021d01020340f50600"],
  ["TIMESTAMP NULL", "'2024-02-29 01:02:03'", "e807021d010203"],
  ["BIT(1)", "b'1'", "01"],
  ["BIT(16)", "b'100000001'", "0101"],
  ["VARCHAR(10)", "'abc'", "616263"],
  ["BLOB", "x'00ff'", "00ff"],
  ["ENUM('a','b')", "'b'", "62"],
];

const text = "CAST(v AS CHAR)";
const bytes = "HEX(v)";
type Stored = string | { mysql: string; mariadb: string };

// [column type, bound value, how to read it back, what it reads]
const parameters: [string, unknown, string, Stored][] = [
  ["TINYINT", true, text, "1"],
  ["TINYINT", false, text, "0"],
  ["TINYINT", -128, text, "-128"],
  ["BIT(1)", true, bytes, "1"],
  ["BIT(16)", 258, bytes, "102"],
  ["BIT(16)", Buffer.from([1, 2]), bytes, "102"],
  ["INT", 2147483647, text, "2147483647"],
  ["INT", -2147483648, text, "-2147483648"],
  ["INT", "42", text, "42"],
  ["INT", 3.7, text, "4"],
  ["INT UNSIGNED", 4294967295, text, "4294967295"],
  ["BIGINT", 4294967296, text, "4294967296"],
  ["BIGINT", -2147483649, text, "-2147483649"],
  ["BIGINT", Number.MAX_SAFE_INTEGER, text, "9007199254740991"],
  ["BIGINT", Number.MIN_SAFE_INTEGER, text, "-9007199254740991"],
  ["BIGINT", 9223372036854775807n, text, "9223372036854775807"],
  ["BIGINT", -9223372036854775808n, text, "-9223372036854775808"],
  ["BIGINT UNSIGNED", 18446744073709551615n, text, "18446744073709551615"],
  ["DOUBLE", 0.1, text, "0.1"],
  ["DOUBLE", 1e308, text, "1e308"],
  ["DOUBLE", 5e-324, text, "5e-324"],
  ["FLOAT", 1.5, text, "1.5"],
  ["DECIMAL(20,5)", "123456789012345.12345", text, "123456789012345.12345"],
  ["DECIMAL(20,5)", 10n, text, "10.00000"],
  ["YEAR", 2024, text, "2024"],
  ["VARCHAR(50)", "😀", bytes, "F09F9880"],
  ["VARCHAR(50)", "a\0b", bytes, "610062"],
  ["VARCHAR(50)", `it's "q" \\ x`, bytes, "6974277320227122205C2078"],
  ["VARCHAR(50)", "", bytes, ""],
  ["VARCHAR(50)", new String("boxed"), text, "boxed"],
  ["VARCHAR(50)", 1.5, text, "1.5"],
  // Every safe integer is an integer to the server, not a double.
  ["VARCHAR(50)", 2 ** 51, text, "2251799813685248"],
  ["VARCHAR(50)", -(2 ** 51) - 1, text, "-2251799813685249"],
  ["VARCHAR(50)", Number.MAX_SAFE_INTEGER, text, "9007199254740991"],
  ["VARCHAR(50)", Number.MIN_SAFE_INTEGER, text, "-9007199254740991"],
  ["VARCHAR(50)", 2 ** 53, text, "9.007199254740992e15"],
  ["VARCHAR(50)", -0, text, { mysql: "-0", mariadb: "0" }],
  ["VARCHAR(50)", 10n, text, "10"],
  ["VARCHAR(20) CHARACTER SET latin1", "café", bytes, "636166E9"],
  ["TEXT", Buffer.alloc(300, "x").toString(), "CAST(LENGTH(v) AS CHAR)", "300"],
  ["VARBINARY(20)", "é", bytes, "C3A9"],
  ["BLOB", Buffer.alloc(0), bytes, ""],
  ["BLOB", Buffer.from("deadbeef", "hex"), bytes, "DEADBEEF"],
  ["BLOB", new Uint8Array([1, 2, 3, 4]).subarray(1, 3), bytes, "0203"],
  ["BLOB", new Uint16Array([1, 2]), bytes, "01000200"],
  ["BLOB", new Uint16Array([1, 2]).buffer, bytes, "01000200"],
  ["BLOB", new DataView(new Uint8Array([1, 2, 3, 4]).buffer, 1, 2), bytes, "0203"],
  ["MEDIUMBLOB", Buffer.alloc(70_000, 0xab), "CONCAT(LENGTH(v), ':', HEX(RIGHT(v, 2)))", "70000:ABAB"],
  ["ENUM('a','b')", "b", text, "b"],
  ["ENUM('a','b')", 1, text, "a"],
  ["SET('x','y','z')", 5, text, "x,z"],
  ["GEOMETRY", hex("000000000101000000000000000000f03f0000000000000040"), "ST_AsText(v)", "POINT(1 2)"],
  ["INT", null, "IFNULL(v, 'is null')", "is null"],
  ["INT", undefined, "IFNULL(v, 'is null')", "is null"],

  // Objects and arrays are JSON text, for any column that takes text.
  ["JSON", '{"a":1}', text, { mysql: '{"a": 1}', mariadb: '{"a":1}' }],
  ["JSON", { a: [1, null] }, text, { mysql: '{"a": [1, null]}', mariadb: '{"a":[1,null]}' }],
  ["JSON", [1, "two"], text, { mysql: '[1, "two"]', mariadb: '[1,"two"]' }],
  ["JSON", { toJSON: () => ({ replaced: true }) }, text, { mysql: '{"replaced": true}', mariadb: '{"replaced":true}' }],
  ["TEXT", { a: "é" }, text, '{"a":"é"}'],
  ["VARCHAR(50)", [], text, "[]"],

  // A Date is its UTC fields.
  ["DATETIME(3)", date("2024-02-29T23:59:59.999Z"), text, "2024-02-29 23:59:59.999"],
  ["DATETIME(6)", date("2024-02-29T23:59:59.001Z"), text, "2024-02-29 23:59:59.001000"],
  ["DATETIME", date("2024-02-29T23:59:59.000Z"), text, "2024-02-29 23:59:59"],
  ["TIMESTAMP(3) NULL", date("1970-01-01T00:00:01.000Z"), text, "1970-01-01 00:00:01.000"],
  ["DATE", date("2024-02-29T12:00:00.000Z"), text, "2024-02-29"],
  ["TIME(3)", date("2024-02-29T01:02:03.456Z"), text, "01:02:03.456"],
  ["DATETIME(3)", date("1970-01-01T00:00:00.000Z"), text, "1970-01-01 00:00:00.000"],
  ["DATETIME(3)", date("1969-12-31T23:59:59.999Z"), text, "1969-12-31 23:59:59.999"],
  ["DATETIME(3)", date("1900-03-01T12:34:56.789Z"), text, "1900-03-01 12:34:56.789"],
  ["DATETIME(3)", date("1600-02-29T00:00:00.001Z"), text, "1600-02-29 00:00:00.001"],
  ["DATETIME(3)", date("0099-12-31T00:00:00.000Z"), text, "0099-12-31 00:00:00.000"],
  ["DATETIME(3)", date("0001-01-01T00:00:00.000Z"), text, "0001-01-01 00:00:00.000"],
  ["DATETIME(3)", date("0000-01-01T00:00:00.000Z"), text, "0000-01-01 00:00:00.000"],
  ["DATETIME(3)", date("9999-12-31T23:59:59.999Z"), text, "9999-12-31 23:59:59.999"],
  ["DATE", date("1969-12-31T00:00:00.000Z"), text, "1969-12-31"],
  ["DATE", date("0001-01-01T00:00:00.000Z"), text, "0001-01-01"],
];

// [name, value, error code]
const refused: [string, unknown, string][] = [
  ["an Invalid Date", invalidDate, "ERR_INVALID_ARG_VALUE"],
  ["a Date in year 10000", date("+010000-01-01T00:00:00.000Z"), "ERR_OUT_OF_RANGE"],
  ["a Date before year 0", date("-000001-12-31T23:59:59.999Z"), "ERR_OUT_OF_RANGE"],
  ["a bigint above 2^64 - 1", 2n ** 64n, "ERR_OUT_OF_RANGE"],
  ["a bigint below -2^63", -(2n ** 63n) - 1n, "ERR_OUT_OF_RANGE"],
  ["a function", () => 1, "ERR_INVALID_ARG_TYPE"],
  ["a class", class {}, "ERR_INVALID_ARG_TYPE"],
  ["an object whose toJSON returns undefined", { toJSON: () => undefined }, "ERR_INVALID_ARG_TYPE"],
  ["a symbol", Symbol("s"), "ERR_INVALID_ARG_TYPE"],
  ["a Number object", new Number(1), "ERR_INVALID_ARG_TYPE"],
  ["a Map", new Map(), "ERR_INVALID_ARG_TYPE"],
];

const describeValue = (value: unknown) =>
  typeof value === "string" && value.length > 40
    ? `string of ${value.length}`
    : Bun.inspect(value).replace(/\s+/g, " ").slice(0, 50);

for (const [server, image] of [
  ["mysql", "mysql_plain"],
  ["mariadb", "mariadb_plain"],
] as const) {
  describeWithContainer(server, { image, concurrent: true }, container => {
    // The temporary table `t` belongs to the one connection of this client.
    async function tableOf(type: string, literals: string[] = []) {
      const sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
      // Zero dates and '' for an ENUM are refused in strict mode.
      await sql`SET sql_mode = ''`.simple();
      await sql.unsafe(`CREATE TEMPORARY TABLE t (id INT AUTO_INCREMENT PRIMARY KEY, v ${type})`).simple();
      if (literals.length > 0) {
        await sql.unsafe(`INSERT INTO t (v) VALUES ${literals.map(literal => `(${literal})`).join(", ")}`).simple();
      }
      return sql;
    }

    test.each(columns)("%s decodes alike in a prepared and a simple query", async (type, rows) => {
      await using sql = await tableOf(
        type,
        rows.map(([literal]) => literal),
      );
      const expected = rows.map(([, v]) => comparable(v));
      expect({
        prepared: (await sql`SELECT v FROM t ORDER BY id`).map(row => comparable(row.v)),
        simple: (await sql`SELECT v FROM t ORDER BY id`.simple()).map(row => comparable(row.v)),
        values: (await sql`SELECT v FROM t ORDER BY id`.values()).map(([v]) => comparable(v)),
      }).toEqual({ prepared: expected, simple: expected, values: expected });
    });

    test("FLOAT is exact in a prepared query and the server's 6 digits in a simple one", async () => {
      await using sql = await tableOf("FLOAT", ["1.5", "0.1", "-3.14159", "3.4e38"]);
      expect({
        prepared: (await sql`SELECT v FROM t ORDER BY id`).map(row => row.v),
        simple: (await sql`SELECT v FROM t ORDER BY id`.simple()).map(row => row.v),
      }).toEqual({
        prepared: [1.5, 0.1, -3.14159, 3.4e38].map(Math.fround),
        simple: [1.5, 0.1, -3.14159, 3.4e38],
      });
    });

    test("expressions decode alike in a prepared and a simple query", async () => {
      await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
      const got: Record<string, { prepared: unknown; simple: unknown }> = {};
      const expected: typeof got = {};
      for (const [expression, value] of expressions) {
        got[expression] = {
          // without a parameter unsafe() is a simple query
          prepared: (await sql.unsafe(`SELECT ${expression} AS v FROM DUAL WHERE 1 = ?`, [1]))[0].v,
          simple: (await sql.unsafe(`SELECT ${expression} AS v`).simple())[0].v,
        };
        expected[expression] = { prepared: value, simple: value };
      }
      expect(got).toEqual(expected);
    });

    test(".raw() hands over the bytes of every type", async () => {
      await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
      await sql`SET sql_mode = ''`.simple();
      const names = rawBinary.map((_, i) => `c${i}`);
      await sql
        .unsafe(`CREATE TEMPORARY TABLE t (${rawBinary.map(([type], i) => `${names[i]} ${type}`).join(", ")})`)
        .simple();
      await sql.unsafe(`INSERT INTO t VALUES (${rawBinary.map(([, literal]) => literal).join(", ")})`).simple();

      const show = (row: unknown[]) =>
        row.map((cell, i) => `${rawBinary[i][0]} ${cell instanceof Uint8Array ? cell.toHex() : Bun.inspect(cell)}`);
      const [prepared] = await sql`SELECT * FROM t`.raw();
      const [simple] = await sql`SELECT * FROM t`.simple().raw();
      // The text protocol's bytes are the text; BIT and BLOB have none.
      const [asText] = await sql
        .unsafe(`SELECT ${names.map(name => `LOWER(HEX(CAST(${name} AS CHAR)))`).join(", ")} FROM t`)
        .simple()
        .values();
      const isBinary = (type: string) => type.startsWith("BIT") || type === "BLOB";
      expect({ prepared: show(prepared), simple: show(simple) }).toEqual({
        prepared: rawBinary.map(([type, , wire]) => `${type} ${wire}`),
        simple: rawBinary.map(([type, , wire], i) => `${type} ${isBinary(type) ? wire : asText[i]}`),
      });
    });

    test.each(parameters.map(row => [row[0], describeValue(row[1]), ...row] as const))(
      "%s <- %s",
      async (_type, _label, type, value, readBack, stored) => {
        await using sql = await tableOf(type);
        await sql`INSERT INTO t (v) VALUES (${value})`;
        const [row] = await sql.unsafe(`SELECT ${readBack} AS s FROM t`).simple();
        expect(String(row.s)).toBe(typeof stored === "string" ? stored : stored[server]);
      },
    );

    test("the type of a number parameter is the type of a result that derives from it", async () => {
      await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
      // A BIGINT outside the range of an INT comes back as a string, a DOUBLE as a number.
      const numbers = [1, 2 ** 31, 2 ** 51 - 1, 2 ** 51, Number.MAX_SAFE_INTEGER, 2 ** 53, 1.5];
      const got: unknown[] = [];
      for (const number of numbers) got.push((await sql`SELECT ${number} AS x`)[0].x);
      expect(got).toEqual([1, 2 ** 31, "2251799813685247", "2251799813685248", "9007199254740991", 2 ** 53, 1.5]);
    });

    test("a Date comes back as the same instant", async () => {
      await using sql = await tableOf("DATETIME(3)");
      const dates = parameters
        .filter(([type, value]) => type === "DATETIME(3)" && value instanceof Date)
        .map(p => p[1]);
      for (const value of dates) await sql`INSERT INTO t (v) VALUES (${value})`;
      expect({
        prepared: (await sql`SELECT v FROM t ORDER BY id`).map(row => row.v),
        simple: (await sql`SELECT v FROM t ORDER BY id`.simple()).map(row => row.v),
      }).toEqual({ prepared: dates, simple: dates });
    });

    test("one statement text takes a different type on every execution", async () => {
      await using sql = await tableOf("VARCHAR(50)");
      const values = [null, 1, "two", 3.5, 4n, true, null, [5], date("2024-01-02T03:04:05.000Z"), Buffer.from("six")];
      for (const value of values) await sql`INSERT INTO t (v) VALUES (${value})`;
      expect((await sql`SELECT v FROM t ORDER BY id`.simple()).map(row => row.v)).toEqual([
        null,
        "1",
        "two",
        "3.5",
        "4",
        "1",
        null,
        "[5]",
        "2024-01-02 03:04:05",
        "six",
      ]);
    });

    test.each(refused)("%s is refused as a parameter", async (_name, value, code) => {
      await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
      const [{ id }] = await sql`SELECT CONNECTION_ID() AS id`;
      expect({
        // once while the statement is prepared, once on the cached statement
        first: await sql`SELECT ${value} AS v`.then(
          rows => rows[0],
          e => e.code,
        ),
        valid: (await sql`SELECT ${"ok"} AS v`)[0],
        second: await sql`SELECT ${value} AS v`.then(
          rows => rows[0],
          e => e.code,
        ),
        sameConnection: (await sql`SELECT CONNECTION_ID() AS id`)[0].id === id,
      }).toEqual({ first: code, valid: { v: "ok" }, second: code, sameConnection: true });
    });
  });
}
