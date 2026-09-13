// bun-types declares `SQL` as a class, and types every client that `Bun.SQL`
// creates as an `SQL`: `new SQL()`, the default `Bun.sql`, the client that a
// transaction or savepoint callback receives, and a reserved connection. `SQL`
// returns a fresh function, so `instanceof SQL` needs an explicit
// `SQL.prototype` that every client inherits from.
//
// `SQL` installs its methods as own properties of the client. A method of a
// subclass prototype with the same name would never run, so `new` on a
// subclass throws.
//
// Constructing a client opens no connection, so the postgres and mysql rows
// of the matrix need no live server: their URLs point at a closed port that is
// never dialed. Only reserve() needs a real server.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

const adapters: [string, string][] = [
  ["sqlite", "sqlite://:memory:"],
  ["postgres", "postgres://bun_sql_test@127.0.0.1:1/bun_sql_test"],
  ["mysql", "mysql://bun_sql_test@127.0.0.1:1/bun_sql_test"],
];

test("SQL.prototype has the attributes of a class prototype", () => {
  expect(Object.getOwnPropertyDescriptor(SQL, "prototype")).toEqual({
    value: SQL.prototype,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  expect(Object.getOwnPropertyDescriptor(SQL.prototype, "constructor")).toEqual({
    value: SQL,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  // A client is a function, so it keeps call, apply and bind.
  expect(Object.getPrototypeOf(SQL.prototype)).toBe(Function.prototype);
});

describe.each(adapters)("%s", (_adapter, url) => {
  test("new SQL() returns an instance of SQL", async () => {
    await using sql = new SQL(url, { max: 1 });
    expect(sql instanceof SQL).toBe(true);
    expect(Object.getPrototypeOf(sql)).toBe(SQL.prototype);
  });

  test("SQL() without new returns an instance of SQL", async () => {
    await using sql = (SQL as unknown as (...args: ConstructorParameters<typeof SQL>) => SQL)(url, { max: 1 });
    expect(sql instanceof SQL).toBe(true);
    expect(Object.getPrototypeOf(sql)).toBe(SQL.prototype);
  });
});

test("an instance of SQL is still a tagged template, with call, apply and bind", async () => {
  await using sql = new SQL("sqlite://:memory:");
  expect(sql instanceof SQL).toBe(true);
  expect(await sql`SELECT 1 AS x`).toEqual([{ x: 1 }]);
  expect(await sql.unsafe("SELECT 2 AS x")).toEqual([{ x: 2 }]);
  expect(sql.bind).toBe(Function.prototype.bind);
});

test("the client that a transaction or savepoint callback receives is an instance of SQL", async () => {
  await using sql = new SQL("sqlite://:memory:");
  const seen = await sql.begin(async tx => ({
    transaction: tx instanceof SQL,
    savepoint: await tx.savepoint(async sp => sp instanceof SQL),
  }));
  expect(seen).toEqual({ transaction: true, savepoint: true });
});

test("the default client Bun.sql is an instance of SQL", () => {
  expect(Bun.sql instanceof SQL).toBe(true);
});

test("new on a subclass of SQL throws", () => {
  class Database extends SQL {}
  expect(() => new Database("sqlite://:memory:")).toThrow(
    new TypeError(
      "Bun.SQL cannot be subclassed. Its methods are own properties of the client, so a subclass cannot override them. Wrap the client instead.",
    ),
  );
  // A new.target that is not a subclass, but whose prototype is not SQL.prototype.
  expect(() => Reflect.construct(SQL, ["sqlite://:memory:"], Object)).toThrow("Bun.SQL cannot be subclassed");
});

test("a new.target whose prototype is SQL.prototype is not a subclass", async () => {
  // `new` on a Proxy of SQL passes the Proxy as new.target.
  const ProxiedSQL = new Proxy(SQL, {});
  await using proxied = new ProxiedSQL("sqlite://:memory:");
  expect(proxied instanceof SQL).toBe(true);
  expect(await proxied`SELECT 1 AS x`).toEqual([{ x: 1 }]);

  // `new` on a bound SQL passes SQL as new.target.
  const BoundSQL = SQL.bind(null, "sqlite://:memory:");
  await using bound = new BoundSQL();
  expect(bound instanceof SQL).toBe(true);
});

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  test("a reserved connection is an instance of SQL", async () => {
    await container.ready;
    await using sql = new SQL(`postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, { max: 1 });
    using reserved = await sql.reserve();
    expect(reserved instanceof SQL).toBe(true);
    expect(await reserved`select 1 as x`).toEqual([{ x: 1 }]);
  });
});
