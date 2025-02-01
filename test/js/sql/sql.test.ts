import { sql, SQL } from "bun";
const postgres = (...args) => new sql(...args);
import { expect, test, mock, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { bunExe, isCI, withoutAggressiveGC, isLinux } from "harness";
import path from "path";

import { exec, execSync } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
import net from "net";
const dockerCLI = Bun.which("docker") as string;

async function findRandomPort() {
  return new Promise((resolve, reject) => {
    // Create a server to listen on a random port
    const server = net.createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}
async function waitForPostgres(port) {
  for (let i = 0; i < 3; i++) {
    try {
      const sql = new SQL(`postgres://postgres@localhost:${port}/postgres`, {
        idle_timeout: 20,
        max_lifetime: 60 * 30,
      });

      await sql`SELECT 1`;
      await sql.end();
      console.log("PostgreSQL is ready!");
      return true;
    } catch (error) {
      console.log(`Waiting for PostgreSQL... (${i + 1}/3)`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error("PostgreSQL failed to start");
}

async function startContainer(): Promise<{ port: number; containerName: string }> {
  try {
    // Build the Docker image
    console.log("Building Docker image...");
    const dockerfilePath = path.join(import.meta.dir, "docker", "Dockerfile");
    await execAsync(`${dockerCLI} build --pull --rm -f "${dockerfilePath}" -t custom-postgres .`, {
      cwd: path.join(import.meta.dir, "docker"),
    });
    const port = await findRandomPort();
    const containerName = `postgres-test-${port}`;
    // Check if container exists and remove it
    try {
      await execAsync(`${dockerCLI} rm -f ${containerName}`);
    } catch (error) {
      // Container might not exist, ignore error
    }

    // Start the container
    await execAsync(`${dockerCLI} run -d --name ${containerName} -p ${port}:5432 custom-postgres`);

    // Wait for PostgreSQL to be ready
    await waitForPostgres(port);
    return {
      port,
      containerName,
    };
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

function isDockerEnabled(): boolean {
  if (!dockerCLI) {
    return false;
  }

  // TODO: investigate why its not starting on Linux arm64
  if (isLinux && process.arch === "arm64") {
    return false;
  }

  try {
    const info = execSync(`${dockerCLI} info`, { stdio: ["ignore", "pipe", "inherit"] });
    return info.toString().indexOf("Server Version:") !== -1;
  } catch {
    return false;
  }
}
if (isDockerEnabled()) {
  const container: { port: number; containerName: string } = await startContainer();
  afterAll(async () => {
    try {
      await execAsync(`${dockerCLI} stop -t 0 ${container.containerName}`);
    } catch (error) {}

    try {
      await execAsync(`${dockerCLI} rm -f ${container.containerName}`);
    } catch (error) {}
  });

  // require("./bootstrap.js");

  // macOS location: /opt/homebrew/var/postgresql@14/pg_hba.conf
  // --- Expected pg_hba.conf ---
  // local all ${USERNAME} trust
  // local all postgres trust
  // local all bun_sql_test_scram scram-sha-256
  // local all bun_sql_test trust
  // local all bun_sql_test_md5 md5

  // # IPv4 local connections:
  // host all ${USERNAME} 127.0.0.1/32 trust
  // host all postgres 127.0.0.1/32 trust
  // host all bun_sql_test_scram 127.0.0.1/32 scram-sha-256
  // host all bun_sql_test 127.0.0.1/32 trust
  // host all bun_sql_test_md5 127.0.0.1/32 md5
  // # IPv6 local connections:
  // host all ${USERNAME} ::1/128 trust
  // host all postgres ::1/128 trust
  // host all bun_sql_test ::1/128 trust
  // host all bun_sql_test_scram ::1/128 scram-sha-256
  // host all bun_sql_test_md5 ::1/128 md5
  // # Allow replication connections from localhost, by a user with the
  // # replication privilege.
  // local replication all trust
  // host replication all 127.0.0.1/32 trust
  // host replication all ::1/128 trust
  // --- Expected pg_hba.conf ---
  process.env.DATABASE_URL = `postgres://bun_sql_test@localhost:${container.port}/bun_sql_test`;

  const login = {
    username: "bun_sql_test",
    port: container.port,
  };

  const login_md5 = {
    username: "bun_sql_test_md5",
    password: "bun_sql_test_md5",
    port: container.port,
  };

  const login_scram = {
    username: "bun_sql_test_scram",
    password: "bun_sql_test_scram",
    port: container.port,
  };

  const options = {
    db: "bun_sql_test",
    username: login.username,
    password: login.password,
    port: container.port,
    max: 1,
  };

  test("Connects with no options", async () => {
    // we need at least the usename and port
    await using sql = postgres({ max: 1, port: container.port, username: login.username });

    const result = (await sql`select 1 as x`)[0].x;
    sql.close();
    expect(result).toBe(1);
  });

  test("Connection timeout works", async () => {
    const onclose = mock();
    const onconnect = mock();
    await using sql = postgres({
      ...options,
      hostname: "example.com",
      connection_timeout: 4,
      onconnect,
      onclose,
      max: 1,
    });
    let error: any;
    try {
      await sql`select pg_sleep(8)`;
    } catch (e) {
      error = e;
    }
    expect(error.code).toBe(`ERR_POSTGRES_CONNECTION_TIMEOUT`);
    expect(error.message).toContain("Connection timeout after 4s");
    expect(onconnect).not.toHaveBeenCalled();
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  test("Idle timeout works at start", async () => {
    const onclose = mock();
    const onconnect = mock();
    await using sql = postgres({
      ...options,
      idle_timeout: 1,
      onconnect,
      onclose,
    });
    let error: any;
    try {
      await sql`select pg_sleep(2)`;
    } catch (e) {
      error = e;
    }
    expect(error.code).toBe(`ERR_POSTGRES_IDLE_TIMEOUT`);
    expect(onconnect).toHaveBeenCalled();
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  test("Idle timeout is reset when a query is run", async () => {
    const onClosePromise = Promise.withResolvers();
    const onclose = mock(err => {
      onClosePromise.resolve(err);
    });
    const onconnect = mock();
    await using sql = postgres({
      ...options,
      idle_timeout: 1,
      onconnect,
      onclose,
    });
    expect(await sql`select 123 as x`).toEqual([{ x: 123 }]);
    expect(onconnect).toHaveBeenCalledTimes(1);
    expect(onclose).not.toHaveBeenCalled();
    const err = await onClosePromise.promise;
    expect(err.code).toBe(`ERR_POSTGRES_IDLE_TIMEOUT`);
  });

  test("Max lifetime works", async () => {
    const onClosePromise = Promise.withResolvers();
    const onclose = mock(err => {
      onClosePromise.resolve(err);
    });
    const onconnect = mock();
    const sql = postgres({
      ...options,
      max_lifetime: 1,
      onconnect,
      onclose,
    });
    let error: any;
    expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
    expect(onconnect).toHaveBeenCalledTimes(1);
    try {
      while (true) {
        for (let i = 0; i < 100; i++) {
          await sql`select pg_sleep(1)`;
        }
      }
    } catch (e) {
      error = e;
    }

    expect(onclose).toHaveBeenCalledTimes(1);

    expect(error.code).toBe(`ERR_POSTGRES_LIFETIME_TIMEOUT`);
  });

  // Last one wins.
  test("Handles duplicate string column names", async () => {
    const result = await sql`select 1 as x, 2 as x, 3 as x`;
    expect(result).toEqual([{ x: 3 }]);
  });

  test("Handles numeric column names", async () => {
    // deliberately out of order
    const result = await sql`select 1 as "1", 2 as "2", 3 as "3", 0 as "0"`;
    expect(result).toEqual([{ "1": 1, "2": 2, "3": 3, "0": 0 }]);

    expect(Object.keys(result[0])).toEqual(["0", "1", "2", "3"]);
    // Sanity check: ensure iterating through the properties doesn't crash.
    Bun.inspect(result);
  });

  // Last one wins.
  test("Handles duplicate numeric column names", async () => {
    const result = await sql`select 1 as "1", 2 as "1", 3 as "1"`;
    expect(result).toEqual([{ "1": 3 }]);
    // Sanity check: ensure iterating through the properties doesn't crash.
    Bun.inspect(result);
  });

  test("Handles mixed column names", async () => {
    const result = await sql`select 1 as "1", 2 as "2", 3 as "3", 4 as x`;
    expect(result).toEqual([{ "1": 1, "2": 2, "3": 3, x: 4 }]);
    // Sanity check: ensure iterating through the properties doesn't crash.
    Bun.inspect(result);
  });

  test("Handles mixed column names with duplicates", async () => {
    const result = await sql`select 1 as "1", 2 as "2", 3 as "3", 4 as "1", 1 as x, 2 as x`;
    expect(result).toEqual([{ "1": 4, "2": 2, "3": 3, x: 2 }]);
    // Sanity check: ensure iterating through the properties doesn't crash.
    Bun.inspect(result);

    // Named columns are inserted first, but they appear from JS as last.
    expect(Object.keys(result[0])).toEqual(["1", "2", "3", "x"]);
  });

  test("Handles mixed column names with duplicates at the end", async () => {
    const result = await sql`select 1 as "1", 2 as "2", 3 as "3", 4 as "1", 1 as x, 2 as x, 3 as x, 4 as "y"`;
    expect(result).toEqual([{ "1": 4, "2": 2, "3": 3, x: 3, y: 4 }]);

    // Sanity check: ensure iterating through the properties doesn't crash.
    Bun.inspect(result);
  });

  test("Handles mixed column names with duplicates at the start", async () => {
    const result = await sql`select 1 as "1", 2 as "1", 3 as "2", 4 as "3", 1 as x, 2 as x, 3 as x`;
    expect(result).toEqual([{ "1": 2, "2": 3, "3": 4, x: 3 }]);
    // Sanity check: ensure iterating through the properties doesn't crash.
    Bun.inspect(result);
  });

  test("Uses default database without slash", async () => {
    const sql = postgres("postgres://localhost");
    expect(sql.options.username).toBe(sql.options.database);
  });

  test("Uses default database with slash", async () => {
    const sql = postgres("postgres://localhost/");
    expect(sql.options.username).toBe(sql.options.database);
  });

  test("Result is array", async () => {
    expect(await sql`select 1`).toBeArray();
  });

  test("Result has command", async () => {
    expect((await sql`select 1`).command).toBe("SELECT");
  });

  test("Create table", async () => {
    await sql`create table test(int int)`;
    await sql`drop table test`;
  });

  test("Drop table", async () => {
    await sql`create table test(int int)`;
    await sql`drop table test`;
    // Verify that table is dropped
    const result = await sql`select * from pg_catalog.pg_tables where tablename = 'test'`;
    expect(result).toBeArrayOfSize(0);
  });

  test("null", async () => {
    expect((await sql`select ${null} as x`)[0].x).toBeNull();
  });

  test("Unsigned Integer", async () => {
    expect((await sql`select ${0x7fffffff + 2} as x`)[0].x).toBe("2147483649");
  });

  test("Signed Integer", async () => {
    expect((await sql`select ${-1} as x`)[0].x).toBe(-1);
    expect((await sql`select ${1} as x`)[0].x).toBe(1);
  });

  test("Double", async () => {
    expect((await sql`select ${1.123456789} as x`)[0].x).toBe(1.123456789);
  });

  test("String", async () => {
    expect((await sql`select ${"hello"} as x`)[0].x).toBe("hello");
  });

  test("Boolean false", async () => expect((await sql`select ${false} as x`)[0].x).toBe(false));

  test("Boolean true", async () => expect((await sql`select ${true} as x`)[0].x).toBe(true));

  test("Date (timestamp)", async () => {
    const now = new Date();
    const then = (await sql`select ${now}::timestamp as x`)[0].x;
    expect(then).toEqual(now);
  });

  test("Date (timestamptz)", async () => {
    const now = new Date();
    const then = (await sql`select ${now}::timestamptz as x`)[0].x;
    expect(then).toEqual(now);
  });

  // t("Json", async () => {
  //   const x = (await sql`select ${sql.json({ a: "hello", b: 42 })} as x`)[0].x;
  //   return ["hello,42", [x.a, x.b].join()];
  // });

  test("implicit json", async () => {
    const x = (await sql`select ${{ a: "hello", b: 42 }}::json as x`)[0].x;
    expect(x).toEqual({ a: "hello", b: 42 });
  });

  test("implicit jsonb", async () => {
    const x = (await sql`select ${{ a: "hello", b: 42 }}::jsonb as x`)[0].x;
    expect(x).toEqual({ a: "hello", b: 42 });
  });

  test("bulk insert nested sql()", async () => {
    await sql`create table users (name text, age int)`;
    const users = [
      { name: "Alice", age: 25 },
      { name: "Bob", age: 30 },
    ];
    try {
      const result = await sql`insert into users ${sql(users)} RETURNING *`;
      expect(result).toEqual([
        { name: "Alice", age: 25 },
        { name: "Bob", age: 30 },
      ]);
    } finally {
      await sql`drop table users`;
    }
  });

  // t("Empty array", async () => [true, Array.isArray((await sql`select ${sql.array([], 1009)} as x`)[0].x)]);

  test("string arg with ::int -> Array<int>", async () =>
    expect((await sql`select ${"{1,2,3}"}::int[] as x`)[0].x).toEqual(new Int32Array([1, 2, 3])));

  // t("Array of Integer", async () => ["3", (await sql`select ${sql.array([1, 2, 3])} as x`)[0].x[2]]);

  // t('Array of String', async() =>
  //   ['c', (await sql`select ${ sql.array(['a', 'b', 'c']) } as x`)[0].x[2]]
  // )

  // test("Array of Date", async () => {
  //   const now = new Date();
  //   const result = await sql`select ${sql.array([now, now, now])} as x`;
  //   expect(result[0].x[2].getTime()).toBe(now.getTime());
  // });

  test.todo("Array of Box", async () => {
    const result = await sql`select ${"{(1,2),(3,4);(4,5),(6,7)}"}::box[] as x`;
    console.log(result);
    expect(result[0].x.join(";")).toBe("(1,2);(3,4);(4,5);(6,7)");
  });

  // t('Nested array n2', async() =>
  //   ['4', (await sql`select ${ sql.array([[1, 2], [3, 4]]) } as x`)[0].x[1][1]]
  // )

  // t('Nested array n3', async() =>
  //   ['6', (await sql`select ${ sql.array([[[1, 2]], [[3, 4]], [[5, 6]]]) } as x`)[0].x[2][0][1]]
  // )

  // t('Escape in arrays', async() =>
  //   ['Hello "you",c:\\windows', (await sql`select ${ sql.array(['Hello "you"', 'c:\\windows']) } as x`)[0].x.join(',')]
  // )

  test("Escapes", async () => {
    expect(Object.keys((await sql`select 1 as ${sql('hej"hej')}`)[0])[0]).toBe('hej"hej');
  });

  // t.only(
  //   "big query body",
  //   async () => {
  //     await sql`create table test (x int)`;
  //     const count = 1000;
  //     const array = new Array(count);
  //     for (let i = 0; i < count; i++) {
  //       array[i] = i;
  //     }
  //     try {
  //       expect((await sql`insert into test SELECT * from UNNEST(${array})`).count).toBe(count);
  //     } finally {
  //       await sql`drop table test`;
  //     }
  //   },
  //   { timeout: 20 * 1000 },
  // );

  test("null for int", async () => {
    const result = await sql`create table test (x int)`;
    expect(result.command).toBe("CREATE TABLE");
    expect(result.count).toBe(0);
    try {
      const result = await sql`insert into test values(${null})`;
      expect(result.command).toBe("INSERT");
      expect(result.count).toBe(1);
    } finally {
      await sql`drop table test`;
    }
  });

  test("Throws on illegal transactions", async () => {
    const sql = postgres({ ...options, max: 2, fetch_types: false });
    const error = await sql`begin`.catch(e => e);
    return expect(error.code).toBe("ERR_POSTGRES_UNSAFE_TRANSACTION");
  });

  test("Transaction throws", async () => {
    await sql`create table if not exists test (a int)`;
    try {
      expect(
        await sql
          .begin(async sql => {
            await sql`insert into test values(1)`;
            await sql`insert into test values('hej')`;
          })
          .catch(e => e.errno),
      ).toBe("22P02");
    } finally {
      await sql`drop table test`;
    }
  });

  test("Transaction rolls back", async () => {
    await sql`create table if not exists test (a int)`;

    try {
      await sql
        .begin(async sql => {
          await sql`insert into test values(1)`;
          await sql`insert into test values('hej')`;
        })
        .catch(() => {
          /* ignore */
        });

      expect((await sql`select a from test`).count).toBe(0);
    } finally {
      await sql`drop table test`;
    }
  });

  test("Transaction throws on uncaught savepoint", async () => {
    await sql`create table test (a int)`;
    try {
      expect(
        await sql
          .begin(async sql => {
            await sql`insert into test values(1)`;
            await sql.savepoint(async sql => {
              await sql`insert into test values(2)`;
              throw new Error("fail");
            });
          })
          .catch(err => err.message),
      ).toBe("fail");
    } finally {
      await sql`drop table test`;
    }
  });

  test("Transaction throws on uncaught named savepoint", async () => {
    await sql`create table test (a int)`;
    try {
      expect(
        await sql
          .begin(async sql => {
            await sql`insert into test values(1)`;
            await sql.savepoit("watpoint", async sql => {
              await sql`insert into test values(2)`;
              throw new Error("fail");
            });
          })
          .catch(() => "fail"),
      ).toBe("fail");
    } finally {
      await sql`drop table test`;
    }
  });

  test("Transaction succeeds on caught savepoint", async () => {
    try {
      await sql`create table test (a int)`;
      await sql.begin(async sql => {
        await sql`insert into test values(1)`;
        await sql
          .savepoint(async sql => {
            await sql`insert into test values(2)`;
            throw new Error("please rollback");
          })
          .catch(() => {
            /* ignore */
          });
        await sql`insert into test values(3)`;
      });
      expect((await sql`select count(1) from test`)[0].count).toBe("2");
    } finally {
      await sql`drop table test`;
    }
  });

  test("Savepoint returns Result", async () => {
    let result;
    await sql.begin(async t => {
      result = await t.savepoint(s => s`select 1 as x`);
    });
    expect(result[0]?.x).toBe(1);
  });

  // test("Prepared transaction", async () => {
  //   await sql`create table test (a int)`;

  //   await sql.begin(async sql => {
  //     await sql`insert into test values(1)`;
  //     await sql.prepare("tx1");
  //   });

  //   await sql`commit prepared 'tx1'`;
  //   try {
  //     expect((await sql`select count(1) from test`)[0].count).toBe("1");
  //   } finally {
  //     await sql`drop table test`;
  //   }
  // });

  test("Prepared transaction", async () => {
    await sql`create table test (a int)`;

    try {
      await sql.beginDistributed("tx1", async sql => {
        await sql`insert into test values(1)`;
      });

      await sql.commitDistributed("tx1");
      expect((await sql`select count(1) from test`)[0].count).toBe("1");
    } finally {
      await sql`drop table test`;
    }
  });

  test("Transaction requests are executed implicitly", async () => {
    await using sql = postgres(options);
    expect(
      (
        await sql.begin(sql => [
          sql`select set_config('bun_sql.test', 'testing', true)`,
          sql`select current_setting('bun_sql.test') as x`,
        ])
      )[1][0].x,
    ).toBe("testing");
  });

  test("Idle timeout retry works", async () => {
    await using sql = postgres({ ...options, idleTimeout: 1 });
    await sql`select 1`;
    await Bun.sleep(1100); // 1.1 seconds so it should retry
    await sql`select 1`;
    expect().pass();
  });

  test("Uncaught transaction request errors bubbles to transaction", async () => {
    const sql = postgres(options);
    process.nextTick(() => sql.close({ timeout: 1 }));
    expect(
      await sql
        .begin(sql => [sql`select wat`, sql`select current_setting('bun_sql.test') as x, ${1} as a`])
        .catch(e => e.errno || e),
    ).toBe("42703");
  });

  test("Fragments in transactions", async () => {
    const sql = postgres({ ...options, debug: true, idle_timeout: 1, fetch_types: false });
    expect((await sql.begin(sql => sql`select true as x where ${sql`1=1`}`))[0].x).toBe(true);
  });

  test("Transaction rejects with rethrown error", async () => {
    await using sql = postgres({ ...options });
    expect(
      await sql
        .begin(async sql => {
          try {
            await sql`select exception`;
          } catch (ex) {
            throw new Error("WAT");
          }
        })
        .catch(e => e.message),
    ).toBe("WAT");
  });

  test("Parallel transactions", async () => {
    await sql`create table test (a int)`;
    expect(
      (await Promise.all([sql.begin(sql => sql`select 1 as count`), sql.begin(sql => sql`select 1 as count`)]))
        .map(x => x[0].count)
        .join(""),
    ).toBe("11");
    await sql`drop table test`;
  });

  test("Many transactions at beginning of connection", async () => {
    await using sql = postgres(options);
    const xs = await Promise.all(Array.from({ length: 100 }, () => sql.begin(sql => sql`select 1`)));
    return expect(xs.length).toBe(100);
  });

  test("Transactions array", async () => {
    await using sql = postgres(options);
    await sql`create table test (a int)`;
    try {
      expect(
        (await sql.begin(sql => [sql`select 1 as count`, sql`select 1 as count`])).map(x => x[0].count).join(""),
      ).toBe("11");
    } finally {
      await sql`drop table test`;
    }
  });

  test("Transaction waits", async () => {
    await using sql = postgres({ ...options });
    await sql`create table test (a int)`;
    try {
      await sql.begin(async sql => {
        await sql`insert into test values(1)`;
        await sql
          .savepoint(async sql => {
            await sql`insert into test values(2)`;
            throw new Error("please rollback");
          })
          .catch(() => {
            /* ignore */
          });
        await sql`insert into test values(3)`;
      });

      expect(
        (await Promise.all([sql.begin(sql => sql`select 1 as count`), sql.begin(sql => sql`select 1 as count`)]))
          .map(x => x[0].count)
          .join(""),
      ).toBe("11");
    } finally {
      await sql`drop table test`;
    }
  });

  test("Helpers in Transaction", async () => {
    const result = await sql.begin(async sql => await sql`select ${sql.unsafe("1 as x")}`);
    expect(result[0].x).toBe(1);
  });

  test("Undefined values throws", async () => {
    // in bun case undefined is null should we fix this? null is a better DX

    // let error;

    // await sql`
    //   select ${undefined} as x
    // `.catch(x => (error = x.code));

    // expect(error).toBe("UNDEFINED_VALUE");

    const result = await sql`select ${undefined} as x`;
    expect(result[0].x).toBeNull();
  });

  // t('Transform undefined', async() => {
  //   const sql = postgres({ ...options, transform: { undefined: null } })
  //   return [null, (await sql`select ${ undefined } as x`)[0].x]
  // })

  // t('Transform undefined in array', async() => {
  //   const sql = postgres({ ...options, transform: { undefined: null } })
  //   return [null, (await sql`select * from (values ${ sql([undefined, undefined]) }) as x(x, y)`)[0].y]
  // })

  test("Null sets to null", async () => expect((await sql`select ${null} as x`)[0].x).toBeNull());

  // Add code property.
  test("Throw syntax error", async () => {
    await using sql = postgres({ ...options, max: 1 });
    const err = await sql`wat 1`.catch(x => x);
    expect(err.errno).toBe("42601");
    expect(err.code).toBe("ERR_POSTGRES_SYNTAX_ERROR");
    expect(err).toBeInstanceOf(SyntaxError);
  });

  test("Connect using uri", async () => [
    true,
    await new Promise((resolve, reject) => {
      const sql = postgres(
        "postgres://" +
          login_md5.username +
          ":" +
          (login_md5.password || "") +
          "@localhost:" +
          container.port +
          "/" +
          options.db,
      );
      sql`select 1`.then(() => resolve(true), reject);
    }),
  ]);

  // t('Options from uri with special characters in user and pass', async() => {
  //   const opt = postgres({ user: 'öla', pass: 'pass^word' }).options
  //   return [[opt.user, opt.pass].toString(), 'öla,pass^word']
  // })

  // t('Fail with proper error on no host', async() =>
  //   ['ECONNREFUSED', (await new Promise((resolve, reject) => {
  //     const sql = postgres('postgres://localhost:33333/' + options.db, {
  //       idle_timeout
  //     })
  //     sql`select 1`.then(reject, resolve)
  //   })).code]
  // )

  // t('Connect using SSL', async() =>
  //   [true, (await new Promise((resolve, reject) => {
  //     postgres({
  //       ssl: { rejectUnauthorized: false },
  //       idle_timeout
  //     })`select 1`.then(() => resolve(true), reject)
  //   }))]
  // )

  // t('Connect using SSL require', async() =>
  //   [true, (await new Promise((resolve, reject) => {
  //     postgres({
  //       ssl: 'require',
  //       idle_timeout
  //     })`select 1`.then(() => resolve(true), reject)
  //   }))]
  // )

  // t('Connect using SSL prefer', async() => {
  //   await exec('psql', ['-c', 'alter system set ssl=off'])
  //   await exec('psql', ['-c', 'select pg_reload_conf()'])

  //   const sql = postgres({
  //     ssl: 'prefer',
  //     idle_timeout
  //   })

  //   return [
  //     1, (await sql`select 1 as x`)[0].x,
  //     await exec('psql', ['-c', 'alter system set ssl=on']),
  //     await exec('psql', ['-c', 'select pg_reload_conf()'])
  //   ]
  // })

  // t('Reconnect using SSL', { timeout: 2 }, async() => {
  //   const sql = postgres({
  //     ssl: 'require',
  //     idle_timeout: 0.1
  //   })

  //   await sql`select 1`
  //   await delay(200)

  //   return [1, (await sql`select 1 as x`)[0].x]
  // })

  test("Login without password", async () => {
    await using sql = postgres({ ...options, ...login });
    expect((await sql`select true as x`)[0].x).toBe(true);
  });

  test("Login using MD5", async () => {
    await using sql = postgres({ ...options, ...login_md5 });
    expect(await sql`select true as x`).toEqual([{ x: true }]);
  });

  test("Login with bad credentials propagates error from server", async () => {
    const sql = postgres({ ...options, ...login_md5, username: "bad_user", password: "bad_password" });
    let err;
    try {
      await sql`select true as x`;
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe("ERR_POSTGRES_SERVER_ERROR");
  });

  test("Login using scram-sha-256", async () => {
    await using sql = postgres({ ...options, ...login_scram });

    // Run it three times to catch any GC
    for (let i = 0; i < 3; i++) {
      expect((await sql`select 1 as x`)[0].x).toBe(1);
    }
  });

  // Promise.all on multiple values in-flight doesn't work currently due to pendingValueGetcached pointing to the wrong value.
  test("Parallel connections using scram-sha-256", async () => {
    await using sql = postgres({ ...options, ...login_scram });
    return [
      true,
      (
        await Promise.all([
          sql`select true as x, pg_sleep(0.01)`,
          sql`select true as x, pg_sleep(0.01)`,
          sql`select true as x, pg_sleep(0.01)`,
        ])
      )[0][0].x,
    ];
  });

  // t('Support dynamic password function', async() => {
  //   return [true, (await postgres({
  //     ...options,
  //     ...login_scram,
  //     pass: () => 'bun_sql_test_scram'
  //   })`select true as x`)[0].x]
  // })

  // t('Support dynamic async password function', async() => {
  //   return [true, (await postgres({
  //     ...options,
  //     ...login_scram,
  //     pass: () => Promise.resolve('bun_sql_test_scram')
  //   })`select true as x`)[0].x]
  // })

  // t('Point type', async() => {
  //   const sql = postgres({
  //     ...options,
  //     types: {
  //       point: {
  //         to: 600,
  //         from: [600],
  //         serialize: ([x, y]) => '(' + x + ',' + y + ')',
  //         parse: (x) => x.slice(1, -1).split(',').map(x => +x)
  //       }
  //     }
  //   })

  //   await sql`create table test (x point)`
  //   await sql`insert into test (x) values (${ sql.types.point([10, 20]) })`
  //   return [20, (await sql`select x from test`)[0].x[1], await sql`drop table test`]
  // })

  // t('Point type array', async() => {
  //   const sql = postgres({
  //     ...options,
  //     types: {
  //       point: {
  //         to: 600,
  //         from: [600],
  //         serialize: ([x, y]) => '(' + x + ',' + y + ')',
  //         parse: (x) => x.slice(1, -1).split(',').map(x => +x)
  //       }
  //     }
  //   })

  //   await sql`create table test (x point[])`
  //   await sql`insert into test (x) values (${ sql.array([sql.types.point([10, 20]), sql.types.point([20, 30])]) })`
  //   return [30, (await sql`select x from test`)[0].x[1][1], await sql`drop table test`]
  // })

  // t('sql file', async() =>
  //   [1, (await sql.file(rel('select.sql')))[0].x]
  // )

  // t('sql file has forEach', async() => {
  //   let result
  //   await sql
  //     .file(rel('select.sql'), { cache: false })
  //     .forEach(({ x }) => result = x)

  //   return [1, result]
  // })

  // t('sql file throws', async() =>
  //   ['ENOENT', (await sql.file(rel('selectomondo.sql')).catch(x => x.code))]
  // )

  // t('sql file cached', async() => {
  //   await sql.file(rel('select.sql'))
  //   await delay(20)

  //   return [1, (await sql.file(rel('select.sql')))[0].x]
  // })

  // t('Parameters in file', async() => {
  //   const result = await sql.file(
  //     rel('select-param.sql'),
  //     ['hello']
  //   )
  //   return ['hello', result[0].x]
  // })

  test("Connection ended promise", async () => {
    const sql = postgres(options);

    await sql.end();

    expect(await sql.end()).toBeUndefined();
  });

  test("Connection ended timeout", async () => {
    const sql = postgres(options);

    await sql.end({ timeout: 10 });

    expect(await sql.end()).toBeUndefined();
  });

  test("Connection ended error", async () => {
    const sql = postgres(options);
    await sql.end();
    return expect(await sql``.catch(x => x.code)).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  });

  test("Connection end does not cancel query", async () => {
    const sql = postgres(options);

    const promise = sql`select pg_sleep(0.2) as x`.execute();
    await sql.end();
    return expect(await promise).toEqual([{ x: "" }]);
  });

  test("Connection destroyed", async () => {
    const sql = postgres(options);
    process.nextTick(() => sql.end({ timeout: 0 }));
    expect(await sql``.catch(x => x.code)).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  });

  test("Connection destroyed with query before", async () => {
    const sql = postgres(options);
    const error = sql`select pg_sleep(0.2)`.catch(err => err.code);

    sql.end({ timeout: 0 });
    return expect(await error).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  });

  // t('transform column', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: { column: x => x.split('').reverse().join('') }
  //   })

  //   await sql`create table test (hello_world int)`
  //   await sql`insert into test values (1)`
  //   return ['dlrow_olleh', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
  // })

  // t('column toPascal', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: { column: postgres.toPascal }
  //   })

  //   await sql`create table test (hello_world int)`
  //   await sql`insert into test values (1)`
  //   return ['HelloWorld', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
  // })

  // t('column toCamel', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: { column: postgres.toCamel }
  //   })

  //   await sql`create table test (hello_world int)`
  //   await sql`insert into test values (1)`
  //   return ['helloWorld', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
  // })

  // t('column toKebab', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: { column: postgres.toKebab }
  //   })

  //   await sql`create table test (hello_world int)`
  //   await sql`insert into test values (1)`
  //   return ['hello-world', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
  // })

  // t('Transform nested json in arrays', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: postgres.camel
  //   })
  //   return ['aBcD', (await sql`select '[{"a_b":1},{"c_d":2}]'::jsonb as x`)[0].x.map(Object.keys).join('')]
  // })

  // t('Transform deeply nested json object in arrays', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: postgres.camel
  //   })
  //   return [
  //     'childObj_deeplyNestedObj_grandchildObj',
  //     (await sql`
  //       select '[{"nested_obj": {"child_obj": 2, "deeply_nested_obj": {"grandchild_obj": 3}}}]'::jsonb as x
  //     `)[0].x.map(x => {
  //       let result
  //       for (const key in x)
  //         result = [...Object.keys(x[key]), ...Object.keys(x[key].deeplyNestedObj)]
  //       return result
  //     })[0]
  //     .join('_')
  //   ]
  // })

  // t('Transform deeply nested json array in arrays', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: postgres.camel
  //   })
  //   return [
  //     'childArray_deeplyNestedArray_grandchildArray',
  //     (await sql`
  //       select '[{"nested_array": [{"child_array": 2, "deeply_nested_array": [{"grandchild_array":3}]}]}]'::jsonb AS x
  //     `)[0].x.map((x) => {
  //       let result
  //       for (const key in x)
  //         result = [...Object.keys(x[key][0]), ...Object.keys(x[key][0].deeplyNestedArray[0])]
  //       return result
  //     })[0]
  //     .join('_')
  //   ]
  // })

  // t('Bypass transform for json primitive', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: postgres.camel
  //   })

  //   const x = (
  //     await sql`select 'null'::json as a, 'false'::json as b, '"a"'::json as c, '1'::json as d`
  //   )[0]

  //   return [
  //     JSON.stringify({ a: null, b: false, c: 'a', d: 1 }),
  //     JSON.stringify(x)
  //   ]
  // })

  // t('Bypass transform for jsonb primitive', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: postgres.camel
  //   })

  //   const x = (
  //     await sql`select 'null'::jsonb as a, 'false'::jsonb as b, '"a"'::jsonb as c, '1'::jsonb as d`
  //   )[0]

  //   return [
  //     JSON.stringify({ a: null, b: false, c: 'a', d: 1 }),
  //     JSON.stringify(x)
  //   ]
  // })

  test("unsafe", async () => {
    await sql`create table test (x int)`;
    try {
      expect(await sql.unsafe("insert into test values ($1) returning *", [1])).toEqual([{ x: 1 }]);
    } finally {
      await sql`drop table test`;
    }
  });

  test("unsafe simple", async () => {
    expect(await sql.unsafe("select 1 as x")).toEqual([{ x: 1 }]);
  });

  // t('unsafe simple includes columns', async() => {
  //   return ['x', (await sql.unsafe('select 1 as x').values()).columns[0].name]
  // })

  // t('unsafe describe', async() => {
  //   const q = 'insert into test values (1)'
  //   await sql`create table test(a int unique)`
  //   await sql.unsafe(q).describe()
  //   const x = await sql.unsafe(q).describe()
  //   return [
  //     q,
  //     x.string,
  //     await sql`drop table test`
  //   ]
  // })

  test.todo("simple query using unsafe with multiple statements", async () => {
    // bun always uses prepared statements, so this is not supported
    //     PostgresError: cannot insert multiple commands into a prepared statement
    //  errno: "42601",
    //   code: "ERR_POSTGRES_SYNTAX_ERROR"
    expect(await sql.unsafe("select 1 as x;select 2 as x")).toEqual([{ x: 1 }, { x: 2 }]);
    // return ["1,2", (await sql.unsafe("select 1 as x;select 2 as x")).map(x => x[0].x).join()];
  });

  // t('simple query using simple() with multiple statements', async() => {
  //   return [
  //     '1,2',
  //     (await sql`select 1 as x;select 2 as x`.simple()).map(x => x[0].x).join()
  //   ]
  // })

  // t('listen and notify', async() => {
  //   const sql = postgres(options)
  //   const channel = 'hello'
  //   const result = await new Promise(async r => {
  //     await sql.listen(channel, r)
  //     sql.notify(channel, 'works')
  //   })

  //   return [
  //     'works',
  //     result,
  //     sql.end()
  //   ]
  // })

  // t('double listen', async() => {
  //   const sql = postgres(options)
  //       , channel = 'hello'

  //   let count = 0

  //   await new Promise((resolve, reject) =>
  //     sql.listen(channel, resolve)
  //     .then(() => sql.notify(channel, 'world'))
  //     .catch(reject)
  //   ).then(() => count++)

  //   await new Promise((resolve, reject) =>
  //     sql.listen(channel, resolve)
  //     .then(() => sql.notify(channel, 'world'))
  //     .catch(reject)
  //   ).then(() => count++)

  //   // for coverage
  //   sql.listen('weee', () => { /* noop */ }).then(sql.end)

  //   return [2, count]
  // })

  // t('multiple listeners work after a reconnect', async() => {
  //   const sql = postgres(options)
  //       , xs = []

  //   const s1 = await sql.listen('test', x => xs.push('1', x))
  //   await sql.listen('test', x => xs.push('2', x))
  //   await sql.notify('test', 'a')
  //   await delay(50)
  //   await sql`select pg_terminate_backend(${ s1.state.pid })`
  //   await delay(200)
  //   await sql.notify('test', 'b')
  //   await delay(50)
  //   sql.end()

  //   return ['1a2a1b2b', xs.join('')]
  // })

  // t('listen and notify with weird name', async() => {
  //   const sql = postgres(options)
  //   const channel = 'wat-;.ø.§'
  //   const result = await new Promise(async r => {
  //     const { unlisten } = await sql.listen(channel, r)
  //     sql.notify(channel, 'works')
  //     await delay(50)
  //     await unlisten()
  //   })

  //   return [
  //     'works',
  //     result,
  //     sql.end()
  //   ]
  // })

  // t('listen and notify with upper case', async() => {
  //   const sql = postgres(options)
  //   const channel = 'withUpperChar'
  //   const result = await new Promise(async r => {
  //     await sql.listen(channel, r)
  //     sql.notify(channel, 'works')
  //   })

  //   return [
  //     'works',
  //     result,
  //     sql.end()
  //   ]
  // })

  // t('listen reconnects', { timeout: 2 }, async() => {
  //   const sql = postgres(options)
  //       , resolvers = {}
  //       , a = new Promise(r => resolvers.a = r)
  //       , b = new Promise(r => resolvers.b = r)

  //   let connects = 0

  //   const { state: { pid } } = await sql.listen(
  //     'test',
  //     x => x in resolvers && resolvers[x](),
  //     () => connects++
  //   )
  //   await sql.notify('test', 'a')
  //   await a
  //   await sql`select pg_terminate_backend(${ pid })`
  //   await delay(100)
  //   await sql.notify('test', 'b')
  //   await b
  //   sql.end()
  //   return [connects, 2]
  // })

  // t('listen result reports correct connection state after reconnection', async() => {
  //   const sql = postgres(options)
  //       , xs = []

  //   const result = await sql.listen('test', x => xs.push(x))
  //   const initialPid = result.state.pid
  //   await sql.notify('test', 'a')
  //   await sql`select pg_terminate_backend(${ initialPid })`
  //   await delay(50)
  //   sql.end()

  //   return [result.state.pid !== initialPid, true]
  // })

  // t('unlisten removes subscription', async() => {
  //   const sql = postgres(options)
  //       , xs = []

  //   const { unlisten } = await sql.listen('test', x => xs.push(x))
  //   await sql.notify('test', 'a')
  //   await delay(50)
  //   await unlisten()
  //   await sql.notify('test', 'b')
  //   await delay(50)
  //   sql.end()

  //   return ['a', xs.join('')]
  // })

  // t('listen after unlisten', async() => {
  //   const sql = postgres(options)
  //       , xs = []

  //   const { unlisten } = await sql.listen('test', x => xs.push(x))
  //   await sql.notify('test', 'a')
  //   await delay(50)
  //   await unlisten()
  //   await sql.notify('test', 'b')
  //   await delay(50)
  //   await sql.listen('test', x => xs.push(x))
  //   await sql.notify('test', 'c')
  //   await delay(50)
  //   sql.end()

  //   return ['ac', xs.join('')]
  // })

  // t('multiple listeners and unlisten one', async() => {
  //   const sql = postgres(options)
  //       , xs = []

  //   await sql.listen('test', x => xs.push('1', x))
  //   const s2 = await sql.listen('test', x => xs.push('2', x))
  //   await sql.notify('test', 'a')
  //   await delay(50)
  //   await s2.unlisten()
  //   await sql.notify('test', 'b')
  //   await delay(50)
  //   sql.end()

  //   return ['1a2a1b', xs.join('')]
  // })

  // t('responds with server parameters (application_name)', async() =>
  //   ['postgres.js', await new Promise((resolve, reject) => postgres({
  //     ...options,
  //     onparameter: (k, v) => k === 'application_name' && resolve(v)
  //   })`select 1`.catch(reject))]
  // )

  // t('has server parameters', async() => {
  //   return ['postgres.js', (await sql`select 1`.then(() => sql.parameters.application_name))]
  // })

  // t('Throws if more than 65534 parameters', async() => {
  //   await sql`create table test (x int)`
  //   return ['MAX_PARAMETERS_EXCEEDED', (await sql`insert into test ${
  //     sql([...Array(65535).keys()].map(x => ({ x })))
  //   }`.catch(e => e.code)), await sql`drop table test`]
  // })

  test("timestamp with time zone is consistent", async () => {
    await sql`create table test (x timestamp with time zone)`;
    try {
      const date = new Date();
      const [{ x }] = await sql`insert into test values (${date}) returning *`;
      expect(x instanceof Date).toBe(true);
      expect(x.toISOString()).toBe(date.toISOString());
    } finally {
      await sql`drop table test`;
    }
  });

  test("timestamp is consistent", async () => {
    await sql`create table test2 (x timestamp)`;
    try {
      const date = new Date();
      const [{ x }] = await sql`insert into test2 values (${date}) returning *`;
      expect(x instanceof Date).toBe(true);
      expect(x.toISOString()).toBe(date.toISOString());
    } finally {
      await sql`drop table test2`;
    }
  });

  test(
    "let postgres do implicit cast of unknown types",
    async () => {
      await sql`create table test3 (x timestamp with time zone)`;
      try {
        const date = new Date("2024-01-01T00:00:00Z");
        const [{ x }] = await sql`insert into test3 values (${date.toISOString()}) returning *`;
        expect(x instanceof Date).toBe(true);
        expect(x.toISOString()).toBe(date.toISOString());
      } finally {
        await sql`drop table test3`;
      }
    },
    { timeout: 1000000 },
  );

  test("only allows one statement", async () => {
    expect(await sql`select 1; select 2`.catch(e => e.errno)).toBe("42601");
  });

  // t('await sql() throws not tagged error', async() => {
  //   let error
  //   try {
  //     await sql('select 1')
  //   } catch (e) {
  //     error = e.code
  //   }
  //   return ['NOT_TAGGED_CALL', error]
  // })

  // t('sql().then throws not tagged error', async() => {
  //   let error
  //   try {
  //     sql('select 1').then(() => { /* noop */ })
  //   } catch (e) {
  //     error = e.code
  //   }
  //   return ['NOT_TAGGED_CALL', error]
  // })

  // t('sql().catch throws not tagged error', async() => {
  //   let error
  //   try {
  //     await sql('select 1')
  //   } catch (e) {
  //     error = e.code
  //   }
  //   return ['NOT_TAGGED_CALL', error]
  // })

  // t('sql().finally throws not tagged error', async() => {
  //   let error
  //   try {
  //     sql('select 1').finally(() => { /* noop */ })
  //   } catch (e) {
  //     error = e.code
  //   }
  //   return ['NOT_TAGGED_CALL', error]
  // })

  test("little bobby tables", async () => {
    const name = "Robert'); DROP TABLE students;--";

    try {
      await sql`create table students (name text, age int)`;
      await sql`insert into students (name) values (${name})`;

      expect((await sql`select name from students`)[0].name).toBe(name);
    } finally {
      await sql`drop table students`;
    }
  });

  test("Connection errors are caught using begin()", async () => {
    let error;
    try {
      const sql = postgres({ host: "localhost", port: 1 });

      await sql.begin(async sql => {
        await sql`insert into test (label, value) values (${1}, ${2})`;
      });
    } catch (err) {
      error = err;
    }
    expect(error.code).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  });

  test("dynamic table name", async () => {
    await sql`create table test(a int)`;
    try {
      return expect((await sql`select * from ${sql("test")}`).length).toBe(0);
    } finally {
      await sql`drop table test`;
    }
  });

  test("dynamic schema name", async () => {
    await sql`create table test(a int)`;
    try {
      return expect((await sql`select * from ${sql("public")}.test`).length).toBe(0);
    } finally {
      await sql`drop table test`;
    }
  });

  test("dynamic schema and table name", async () => {
    await sql`create table test(a int)`;
    try {
      return expect((await sql`select * from ${sql("public.test")}`).length).toBe(0);
    } finally {
      await sql`drop table test`;
    }
  });

  test("dynamic column name", async () => {
    const result = await sql`select 1 as ${sql("!not_valid")}`;
    expect(Object.keys(result[0])[0]).toBe("!not_valid");
  });

  // t('dynamic select as', async() => {
  //   return ['2', (await sql`select ${ sql({ a: 1, b: 2 }) }`)[0].b]
  // })

  // t('dynamic select as pluck', async() => {
  //   return [undefined, (await sql`select ${ sql({ a: 1, b: 2 }, 'a') }`)[0].b]
  // })

  test("dynamic insert", async () => {
    await sql`create table test (a int, b text)`;
    try {
      const x = { a: 42, b: "the answer" };
      expect((await sql`insert into test ${sql(x)} returning *`)[0].b).toBe("the answer");
    } finally {
      await sql`drop table test`;
    }
  });

  test("dynamic insert pluck", async () => {
    try {
      await sql`create table test2 (a int, b text)`;
      const x = { a: 42, b: "the answer" };
      const [{ b, a }] = await sql`insert into test2 ${sql(x, "a")} returning *`;
      expect(b).toBeNull();
      expect(a).toBe(42);
    } finally {
      await sql`drop table test2`;
    }
  });

  // t('dynamic in with empty array', async() => {
  //   await sql`create table test (a int)`
  //   await sql`insert into test values (1)`
  //   return [
  //     (await sql`select * from test where null in ${ sql([]) }`).count,
  //     0,
  //     await sql`drop table test`
  //   ]
  // })

  // t('dynamic in after insert', async() => {
  //   await sql`create table test (a int, b text)`
  //   const [{ x }] = await sql`
  //     with x as (
  //       insert into test values (1, 'hej')
  //       returning *
  //     )
  //     select 1 in ${ sql([1, 2, 3]) } as x from x
  //   `
  //   return [
  //     true, x,
  //     await sql`drop table test`
  //   ]
  // })

  // t('array insert', async() => {
  //   await sql`create table test (a int, b int)`
  //   return [2, (await sql`insert into test (a, b) values ${ sql([1, 2]) } returning *`)[0].b, await sql`drop table test`]
  // })

  // t('where parameters in()', async() => {
  //   await sql`create table test (x text)`
  //   await sql`insert into test values ('a')`
  //   return [
  //     (await sql`select * from test where x in ${ sql(['a', 'b', 'c']) }`)[0].x,
  //     'a',
  //     await sql`drop table test`
  //   ]
  // })

  // t('where parameters in() values before', async() => {
  //   return [2, (await sql`
  //     with rows as (
  //       select * from (values (1), (2), (3), (4)) as x(a)
  //     )
  //     select * from rows where a in ${ sql([3, 4]) }
  //   `).count]
  // })

  // t('dynamic multi row insert', async() => {
  //   await sql`create table test (a int, b text)`
  //   const x = { a: 42, b: 'the answer' }

  //   return [
  //     'the answer',
  //     (await sql`insert into test ${ sql([x, x]) } returning *`)[1].b, await sql`drop table test`
  //   ]
  // })

  // t('dynamic update', async() => {
  //   await sql`create table test (a int, b text)`
  //   await sql`insert into test (a, b) values (17, 'wrong')`

  //   return [
  //     'the answer',
  //     (await sql`update test set ${ sql({ a: 42, b: 'the answer' }) } returning *`)[0].b, await sql`drop table test`
  //   ]
  // })

  // t('dynamic update pluck', async() => {
  //   await sql`create table test (a int, b text)`
  //   await sql`insert into test (a, b) values (17, 'wrong')`

  //   return [
  //     'wrong',
  //     (await sql`update test set ${ sql({ a: 42, b: 'the answer' }, 'a') } returning *`)[0].b, await sql`drop table test`
  //   ]
  // })

  // t('dynamic select array', async() => {
  //   await sql`create table test (a int, b text)`
  //   await sql`insert into test (a, b) values (42, 'yay')`
  //   return ['yay', (await sql`select ${ sql(['a', 'b']) } from test`)[0].b, await sql`drop table test`]
  // })

  // t('dynamic returning array', async() => {
  //   await sql`create table test (a int, b text)`
  //   return [
  //     'yay',
  //     (await sql`insert into test (a, b) values (42, 'yay') returning ${ sql(['a', 'b']) }`)[0].b,
  //     await sql`drop table test`
  //   ]
  // })

  // t('dynamic select args', async() => {
  //   await sql`create table test (a int, b text)`
  //   await sql`insert into test (a, b) values (42, 'yay')`
  //   return ['yay', (await sql`select ${ sql('a', 'b') } from test`)[0].b, await sql`drop table test`]
  // })

  // t('dynamic values single row', async() => {
  //   const [{ b }] = await sql`
  //     select * from (values ${ sql(['a', 'b', 'c']) }) as x(a, b, c)
  //   `

  //   return ['b', b]
  // })

  // t('dynamic values multi row', async() => {
  //   const [, { b }] = await sql`
  //     select * from (values ${ sql([['a', 'b', 'c'], ['a', 'b', 'c']]) }) as x(a, b, c)
  //   `

  //   return ['b', b]
  // })

  // t('connection parameters', async() => {
  //   const sql = postgres({
  //     ...options,
  //     connection: {
  //       'some.var': 'yay'
  //     }
  //   })

  //   return ['yay', (await sql`select current_setting('some.var') as x`)[0].x]
  // })

  // t('Multiple queries', async() => {
  //   const sql = postgres(options)

  //   return [4, (await Promise.all([
  //     sql`select 1`,
  //     sql`select 2`,
  //     sql`select 3`,
  //     sql`select 4`
  //   ])).length]
  // })

  // t('Multiple statements', async() =>
  //   [2, await sql.unsafe(`
  //     select 1 as x;
  //     select 2 as a;
  //   `).then(([, [x]]) => x.a)]
  // )

  // t('throws correct error when authentication fails', async() => {
  //   const sql = postgres({
  //     ...options,
  //     ...login_md5,
  //     pass: 'wrong'
  //   })
  //   return ['28P01', await sql`select 1`.catch(e => e.code)]
  // })

  // t('notice', async() => {
  //   let notice
  //   const log = console.log // eslint-disable-line
  //   console.log = function(x) { // eslint-disable-line
  //     notice = x
  //   }

  //   const sql = postgres(options)

  //   await sql`create table if not exists users()`
  //   await sql`create table if not exists users()`

  //   console.log = log // eslint-disable-line

  //   return ['NOTICE', notice.severity]
  // })

  // t('notice hook', async() => {
  //   let notice
  //   const sql = postgres({
  //     ...options,
  //     onnotice: x => notice = x
  //   })

  //   await sql`create table if not exists users()`
  //   await sql`create table if not exists users()`

  //   return ['NOTICE', notice.severity]
  // })

  // t('bytea serializes and parses', async() => {
  //   const buf = Buffer.from('wat')

  //   await sql`create table test (x bytea)`
  //   await sql`insert into test values (${ buf })`

  //   return [
  //     buf.toString(),
  //     (await sql`select x from test`)[0].x.toString(),
  //     await sql`drop table test`
  //   ]
  // })

  // t('forEach', async() => {
  //   let result
  //   await sql`select 1 as x`.forEach(({ x }) => result = x)
  //   return [1, result]
  // })

  // t('forEach returns empty array', async() => {
  //   return [0, (await sql`select 1 as x`.forEach(() => { /* noop */ })).length]
  // })

  // t('Cursor', async() => {
  //   const order = []
  //   await sql`select 1 as x union select 2 as x`.cursor(async([x]) => {
  //     order.push(x.x + 'a')
  //     await delay(100)
  //     order.push(x.x + 'b')
  //   })
  //   return ['1a1b2a2b', order.join('')]
  // })

  // t('Unsafe cursor', async() => {
  //   const order = []
  //   await sql.unsafe('select 1 as x union select 2 as x').cursor(async([x]) => {
  //     order.push(x.x + 'a')
  //     await delay(100)
  //     order.push(x.x + 'b')
  //   })
  //   return ['1a1b2a2b', order.join('')]
  // })

  // t('Cursor custom n', async() => {
  //   const order = []
  //   await sql`select * from generate_series(1,20)`.cursor(10, async(x) => {
  //     order.push(x.length)
  //   })
  //   return ['10,10', order.join(',')]
  // })

  // t('Cursor custom with rest n', async() => {
  //   const order = []
  //   await sql`select * from generate_series(1,20)`.cursor(11, async(x) => {
  //     order.push(x.length)
  //   })
  //   return ['11,9', order.join(',')]
  // })

  // t('Cursor custom with less results than batch size', async() => {
  //   const order = []
  //   await sql`select * from generate_series(1,20)`.cursor(21, async(x) => {
  //     order.push(x.length)
  //   })
  //   return ['20', order.join(',')]
  // })

  // t('Cursor cancel', async() => {
  //   let result
  //   await sql`select * from generate_series(1,10) as x`.cursor(async([{ x }]) => {
  //     result = x
  //     return sql.CLOSE
  //   })
  //   return [1, result]
  // })

  // t('Cursor throw', async() => {
  //   const order = []
  //   await sql`select 1 as x union select 2 as x`.cursor(async([x]) => {
  //     order.push(x.x + 'a')
  //     await delay(100)
  //     throw new Error('watty')
  //   }).catch(() => order.push('err'))
  //   return ['1aerr', order.join('')]
  // })

  // t('Cursor error', async() => [
  //   '42601',
  //   await sql`wat`.cursor(() => { /* noop */ }).catch((err) => err.code)
  // ])

  // t('Multiple Cursors', { timeout: 2 }, async() => {
  //   const result = []
  //   await sql.begin(async sql => [
  //     await sql`select 1 as cursor, x from generate_series(1,4) as x`.cursor(async([row]) => {
  //       result.push(row.x)
  //       await new Promise(r => setTimeout(r, 20))
  //     }),
  //     await sql`select 2 as cursor, x from generate_series(101,104) as x`.cursor(async([row]) => {
  //       result.push(row.x)
  //       await new Promise(r => setTimeout(r, 10))
  //     })
  //   ])

  //   return ['1,2,3,4,101,102,103,104', result.join(',')]
  // })

  // t('Cursor as async iterator', async() => {
  //   const order = []
  //   for await (const [x] of sql`select generate_series(1,2) as x;`.cursor()) {
  //     order.push(x.x + 'a')
  //     await delay(10)
  //     order.push(x.x + 'b')
  //   }

  //   return ['1a1b2a2b', order.join('')]
  // })

  // t('Cursor as async iterator with break', async() => {
  //   const order = []
  //   for await (const xs of sql`select generate_series(1,2) as x;`.cursor()) {
  //     order.push(xs[0].x + 'a')
  //     await delay(10)
  //     order.push(xs[0].x + 'b')
  //     break
  //   }

  //   return ['1a1b', order.join('')]
  // })

  // t('Async Iterator Unsafe cursor', async() => {
  //   const order = []
  //   for await (const [x] of sql.unsafe('select 1 as x union select 2 as x').cursor()) {
  //     order.push(x.x + 'a')
  //     await delay(10)
  //     order.push(x.x + 'b')
  //   }
  //   return ['1a1b2a2b', order.join('')]
  // })

  // t('Async Iterator Cursor custom n', async() => {
  //   const order = []
  //   for await (const x of sql`select * from generate_series(1,20)`.cursor(10))
  //     order.push(x.length)

  //   return ['10,10', order.join(',')]
  // })

  // t('Async Iterator Cursor custom with rest n', async() => {
  //   const order = []
  //   for await (const x of sql`select * from generate_series(1,20)`.cursor(11))
  //     order.push(x.length)

  //   return ['11,9', order.join(',')]
  // })

  // t('Async Iterator Cursor custom with less results than batch size', async() => {
  //   const order = []
  //   for await (const x of sql`select * from generate_series(1,20)`.cursor(21))
  //     order.push(x.length)
  //   return ['20', order.join(',')]
  // })

  // t('Transform row', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: { row: () => 1 }
  //   })

  //   return [1, (await sql`select 'wat'`)[0]]
  // })

  // t('Transform row forEach', async() => {
  //   let result
  //   const sql = postgres({
  //     ...options,
  //     transform: { row: () => 1 }
  //   })

  //   await sql`select 1`.forEach(x => result = x)

  //   return [1, result]
  // })

  // t('Transform value', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: { value: () => 1 }
  //   })

  //   return [1, (await sql`select 'wat' as x`)[0].x]
  // })

  // t('Transform columns from', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: postgres.fromCamel
  //   })
  //   await sql`create table test (a_test int, b_test text)`
  //   await sql`insert into test ${ sql([{ aTest: 1, bTest: 1 }]) }`
  //   await sql`update test set ${ sql({ aTest: 2, bTest: 2 }) }`
  //   return [
  //     2,
  //     (await sql`select ${ sql('aTest', 'bTest') } from test`)[0].a_test,
  //     await sql`drop table test`
  //   ]
  // })

  // t('Transform columns to', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: postgres.toCamel
  //   })
  //   await sql`create table test (a_test int, b_test text)`
  //   await sql`insert into test ${ sql([{ a_test: 1, b_test: 1 }]) }`
  //   await sql`update test set ${ sql({ a_test: 2, b_test: 2 }) }`
  //   return [
  //     2,
  //     (await sql`select a_test, b_test from test`)[0].aTest,
  //     await sql`drop table test`
  //   ]
  // })

  // t('Transform columns from and to', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: postgres.camel
  //   })
  //   await sql`create table test (a_test int, b_test text)`
  //   await sql`insert into test ${ sql([{ aTest: 1, bTest: 1 }]) }`
  //   await sql`update test set ${ sql({ aTest: 2, bTest: 2 }) }`
  //   return [
  //     2,
  //     (await sql`select ${ sql('aTest', 'bTest') } from test`)[0].aTest,
  //     await sql`drop table test`
  //   ]
  // })

  // t('Transform columns from and to (legacy)', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: {
  //       column: {
  //         to: postgres.fromCamel,
  //         from: postgres.toCamel
  //       }
  //     }
  //   })
  //   await sql`create table test (a_test int, b_test text)`
  //   await sql`insert into test ${ sql([{ aTest: 1, bTest: 1 }]) }`
  //   await sql`update test set ${ sql({ aTest: 2, bTest: 2 }) }`
  //   return [
  //     2,
  //     (await sql`select ${ sql('aTest', 'bTest') } from test`)[0].aTest,
  //     await sql`drop table test`
  //   ]
  // })

  // t('Unix socket', async() => {
  //   const sql = postgres({
  //     ...options,
  //     host: process.env.PGSOCKET || '/tmp' // eslint-disable-line
  //   })

  //   return [1, (await sql`select 1 as x`)[0].x]
  // })

  test.skipIf(isCI)(
    "Big result",
    async () => {
      await using sql = postgres(options);
      const result = await sql`select * from generate_series(1, 100000)`;
      expect(result.count).toBe(100000);
      let i = 1;

      for (const row of result) {
        expect(row.generate_series).toBe(i++);
      }
    },
    10000,
  );

  // t('Debug', async() => {
  //   let result
  //   const sql = postgres({
  //     ...options,
  //     debug: (connection_id, str) => result = str
  //   })

  //   await sql`select 1`

  //   return ['select 1', result]
  // })

  test("bigint is returned as String", async () => {
    expect(typeof (await sql`select 9223372036854777 as x`)[0].x).toBe("string");
  });

  test("bigint is returned as BigInt", async () => {
    await using sql = postgres({
      ...options,
      bigint: true,
    });
    expect((await sql`select 9223372036854777 as x`)[0].x).toBe(9223372036854777n);
  });

  test("int is returned as Number", async () => {
    expect((await sql`select 123 as x`)[0].x).toBe(123);
  });

  test("numeric is returned as string", async () => {
    const result = (await sql`select 1.2 as x`)[0].x;
    expect(result).toBe("1.2");
  });

  // t('Async stack trace', async() => {
  //   const sql = postgres({ ...options, debug: false })
  //   return [
  //     parseInt(new Error().stack.split('\n')[1].match(':([0-9]+):')[1]) + 1,
  //     parseInt(await sql`error`.catch(x => x.stack.split('\n').pop().match(':([0-9]+):')[1]))
  //   ]
  // })

  // t('Debug has long async stack trace', async() => {
  //   const sql = postgres({ ...options, debug: true })

  //   return [
  //     'watyo',
  //     await yo().catch(x => x.stack.match(/wat|yo/g).join(''))
  //   ]

  //   function yo() {
  //     return wat()
  //   }

  //   function wat() {
  //     return sql`error`
  //   }
  // })

  // t('Error contains query string', async() => [
  //   'selec 1',
  //   (await sql`selec 1`.catch(err => err.query))
  // ])

  // t('Error contains query serialized parameters', async() => [
  //   1,
  //   (await sql`selec ${ 1 }`.catch(err => err.parameters[0]))
  // ])

  // t('Error contains query raw parameters', async() => [
  //   1,
  //   (await sql`selec ${ 1 }`.catch(err => err.args[0]))
  // ])

  // t('Query and parameters on errorare not enumerable if debug is not set', async() => {
  //   const sql = postgres({ ...options, debug: false })

  //   return [
  //     false,
  //     (await sql`selec ${ 1 }`.catch(err => err.propertyIsEnumerable('parameters') || err.propertyIsEnumerable('query')))
  //   ]
  // })

  // t('Query and parameters are enumerable if debug is set', async() => {
  //   const sql = postgres({ ...options, debug: true })

  //   return [
  //     true,
  //     (await sql`selec ${ 1 }`.catch(err => err.propertyIsEnumerable('parameters') && err.propertyIsEnumerable('query')))
  //   ]
  // })

  // t('connect_timeout', { timeout: 20 }, async() => {
  //   const connect_timeout = 0.2
  //   const server = net.createServer()
  //   server.listen()
  //   const sql = postgres({ port: server.address().port, host: '127.0.0.1', connect_timeout })
  //   const start = Date.now()
  //   let end
  //   await sql`select 1`.catch((e) => {
  //     if (e.code !== 'CONNECT_TIMEOUT')
  //       throw e
  //     end = Date.now()
  //   })
  //   server.close()
  //   return [connect_timeout, Math.floor((end - start) / 100) / 10]
  // })

  // t('connect_timeout throws proper error', async() => [
  //   'CONNECT_TIMEOUT',
  //   await postgres({
  //     ...options,
  //     ...login_scram,
  //     connect_timeout: 0.001
  //   })`select 1`.catch(e => e.code)
  // ])

  // t('connect_timeout error message includes host:port', { timeout: 20 }, async() => {
  //   const connect_timeout = 0.2
  //   const server = net.createServer()
  //   server.listen()
  //   const sql = postgres({ port: server.address().port, host: '127.0.0.1', connect_timeout })
  //   const port = server.address().port
  //   let err
  //   await sql`select 1`.catch((e) => {
  //     if (e.code !== 'CONNECT_TIMEOUT')
  //       throw e
  //     err = e.message
  //   })
  //   server.close()
  //   return [['write CONNECT_TIMEOUT 127.0.0.1:', port].join(''), err]
  // })

  // t('requests works after single connect_timeout', async() => {
  //   let first = true

  //   const sql = postgres({
  //     ...options,
  //     ...login_scram,
  //     connect_timeout: { valueOf() { return first ? (first = false, 0.0001) : 1 } }
  //   })

  //   return [
  //     'CONNECT_TIMEOUT,,1',
  //     [
  //       await sql`select 1 as x`.then(() => 'success', x => x.code),
  //       await delay(10),
  //       (await sql`select 1 as x`)[0].x
  //     ].join(',')
  //   ]
  // })

  // t('Postgres errors are of type PostgresError', async() =>
  //   [true, (await sql`bad keyword`.catch(e => e)) instanceof sql.PostgresError]
  // )

  test.todo("Result has columns spec", async () => {
    expect((await sql`select 1 as x`).columns[0].name).toBe("x");
  });

  // t('forEach has result as second argument', async() => {
  //   let x
  //   await sql`select 1 as x`.forEach((_, result) => x = result)
  //   return ['x', x.columns[0].name]
  // })

  // t('Result as arrays', async() => {
  //   const sql = postgres({
  //     ...options,
  //     transform: {
  //       row: x => Object.values(x)
  //     }
  //   })

  //   return ['1,2', (await sql`select 1 as a, 2 as b`)[0].join(',')]
  // })

  // t('Insert empty array', async() => {
  //   await sql`create table tester (ints int[])`
  //   return [
  //     Array.isArray((await sql`insert into tester (ints) values (${ sql.array([]) }) returning *`)[0].ints),
  //     true,
  //     await sql`drop table tester`
  //   ]
  // })

  // t('Insert array in sql()', async() => {
  //   await sql`create table tester (ints int[])`
  //   return [
  //     Array.isArray((await sql`insert into tester ${ sql({ ints: sql.array([]) }) } returning *`)[0].ints),
  //     true,
  //     await sql`drop table tester`
  //   ]
  // })

  // t('Automatically creates prepared statements', async() => {
  //   const sql = postgres(options)
  //   const result = await sql`select * from pg_prepared_statements`
  //   return [true, result.some(x => x.name = result.statement.name)]
  // })

  // t('no_prepare: true disables prepared statements (deprecated)', async() => {
  //   const sql = postgres({ ...options, no_prepare: true })
  //   const result = await sql`select * from pg_prepared_statements`
  //   return [false, result.some(x => x.name = result.statement.name)]
  // })

  // t('prepare: false disables prepared statements', async() => {
  //   const sql = postgres({ ...options, prepare: false })
  //   const result = await sql`select * from pg_prepared_statements`
  //   return [false, result.some(x => x.name = result.statement.name)]
  // })

  // t('prepare: true enables prepared statements', async() => {
  //   const sql = postgres({ ...options, prepare: true })
  //   const result = await sql`select * from pg_prepared_statements`
  //   return [true, result.some(x => x.name = result.statement.name)]
  // })

  // t('prepares unsafe query when "prepare" option is true', async() => {
  //   const sql = postgres({ ...options, prepare: true })
  //   const result = await sql.unsafe('select * from pg_prepared_statements where name <> $1', ['bla'], { prepare: true })
  //   return [true, result.some(x => x.name = result.statement.name)]
  // })

  // t('does not prepare unsafe query by default', async() => {
  //   const sql = postgres({ ...options, prepare: true })
  //   const result = await sql.unsafe('select * from pg_prepared_statements where name <> $1', ['bla'])
  //   return [false, result.some(x => x.name = result.statement.name)]
  // })

  // t('Recreate prepared statements on transformAssignedExpr error', { timeout: 1 }, async() => {
  //   const insert = () => sql`insert into test (name) values (${ '1' }) returning name`
  //   await sql`create table test (name text)`
  //   await insert()
  //   await sql`alter table test alter column name type int using name::integer`
  //   return [
  //     1,
  //     (await insert())[0].name,
  //     await sql`drop table test`
  //   ]
  // })

  // t('Throws correct error when retrying in transactions', async() => {
  //   await sql`create table test(x int)`
  //   const error = await sql.begin(sql => sql`insert into test (x) values (${ false })`).catch(e => e)
  //   return [
  //     error.code,
  //     '42804',
  //     sql`drop table test`
  //   ]
  // })

  // t('Recreate prepared statements on RevalidateCachedQuery error', async() => {
  //   const select = () => sql`select name from test`
  //   await sql`create table test (name text)`
  //   await sql`insert into test values ('1')`
  //   await select()
  //   await sql`alter table test alter column name type int using name::integer`
  //   return [
  //     1,
  //     (await select())[0].name,
  //     await sql`drop table test`
  //   ]
  // })

  // t('Catches connection config errors', async() => {
  //   const sql = postgres({ ...options, user: { toString: () => { throw new Error('wat') } }, database: 'prut' })

  //   return [
  //     'wat',
  //     await sql`select 1`.catch((e) => e.message)
  //   ]
  // })

  // t('Catches connection config errors with end', async() => {
  //   const sql = postgres({ ...options, user: { toString: () => { throw new Error('wat') } }, database: 'prut' })

  //   return [
  //     'wat',
  //     await sql`select 1`.catch((e) => e.message),
  //     await sql.end()
  //   ]
  // })

  // t('Catches query format errors', async() => [
  //   'wat',
  //   await sql.unsafe({ toString: () => { throw new Error('wat') } }).catch((e) => e.message)
  // ])

  // t('Multiple hosts', {
  //   timeout: 1
  // }, async() => {
  //   const s1 = postgres({ idle_timeout })
  //       , s2 = postgres({ idle_timeout, port: 5433 })
  //       , sql = postgres('postgres://localhost:5432,localhost:5433', { idle_timeout, max: 1 })
  //       , result = []

  //   const id1 = (await s1`select system_identifier as x from pg_control_system()`)[0].x
  //   const id2 = (await s2`select system_identifier as x from pg_control_system()`)[0].x

  //   const x1 = await sql`select 1`
  //   result.push((await sql`select system_identifier as x from pg_control_system()`)[0].x)
  //   await s1`select pg_terminate_backend(${ x1.state.pid }::int)`
  //   await delay(50)

  //   const x2 = await sql`select 1`
  //   result.push((await sql`select system_identifier as x from pg_control_system()`)[0].x)
  //   await s2`select pg_terminate_backend(${ x2.state.pid }::int)`
  //   await delay(50)

  //   result.push((await sql`select system_identifier as x from pg_control_system()`)[0].x)

  //   return [[id1, id2, id1].join(','), result.join(',')]
  // })

  // t('Escaping supports schemas and tables', async() => {
  //   await sql`create schema a`
  //   await sql`create table a.b (c int)`
  //   await sql`insert into a.b (c) values (1)`
  //   return [
  //     1,
  //     (await sql`select ${ sql('a.b.c') } from a.b`)[0].c,
  //     await sql`drop table a.b`,
  //     await sql`drop schema a`
  //   ]
  // })

  // t('Raw method returns rows as arrays', async() => {
  //   const [x] = await sql`select 1`.raw()
  //   return [
  //     Array.isArray(x),
  //     true
  //   ]
  // })

  // t('Raw method returns values unparsed as Buffer', async() => {
  //   const [[x]] = await sql`select 1`.raw()
  //   return [
  //     x instanceof Uint8Array,
  //     true
  //   ]
  // })

  test("Array returns rows as arrays of columns", async () => {
    return [(await sql`select 1`.values())[0][0], 1];
  });

  // t('Copy read', async() => {
  //   const result = []

  //   await sql`create table test (x int)`
  //   await sql`insert into test select * from generate_series(1,10)`
  //   const readable = await sql`copy test to stdout`.readable()
  //   readable.on('data', x => result.push(x))
  //   await new Promise(r => readable.on('end', r))

  //   return [
  //     result.length,
  //     10,
  //     await sql`drop table test`
  //   ]
  // })

  // t('Copy write', { timeout: 2 }, async() => {
  //   await sql`create table test (x int)`
  //   const writable = await sql`copy test from stdin`.writable()

  //   writable.write('1\n')
  //   writable.write('1\n')
  //   writable.end()

  //   await new Promise(r => writable.on('finish', r))

  //   return [
  //     (await sql`select 1 from test`).length,
  //     2,
  //     await sql`drop table test`
  //   ]
  // })

  // t('Copy write as first', async() => {
  //   await sql`create table test (x int)`
  //   const first = postgres(options)
  //   const writable = await first`COPY test FROM STDIN WITH(FORMAT csv, HEADER false, DELIMITER ',')`.writable()
  //   writable.write('1\n')
  //   writable.write('1\n')
  //   writable.end()

  //   await new Promise(r => writable.on('finish', r))

  //   return [
  //     (await sql`select 1 from test`).length,
  //     2,
  //     await sql`drop table test`
  //   ]
  // })

  // t('Copy from file', async() => {
  //   await sql`create table test (x int, y int, z int)`
  //   await new Promise(async r => fs
  //     .createReadStream(rel('copy.csv'))
  //     .pipe(await sql`copy test from stdin`.writable())
  //     .on('finish', r)
  //   )

  //   return [
  //     JSON.stringify(await sql`select * from test`),
  //     '[{"x":1,"y":2,"z":3},{"x":4,"y":5,"z":6}]',
  //     await sql`drop table test`
  //   ]
  // })

  // t('Copy from works in transaction', async() => {
  //   await sql`create table test(x int)`
  //   const xs = await sql.begin(async sql => {
  //     (await sql`copy test from stdin`.writable()).end('1\n2')
  //     await delay(20)
  //     return sql`select 1 from test`
  //   })

  //   return [
  //     xs.length,
  //     2,
  //     await sql`drop table test`
  //   ]
  // })

  // t('Copy from abort', async() => {
  //   const sql = postgres(options)
  //   const readable = fs.createReadStream(rel('copy.csv'))

  //   await sql`create table test (x int, y int, z int)`
  //   await sql`TRUNCATE TABLE test`

  //   const writable = await sql`COPY test FROM STDIN`.writable()

  //   let aborted

  //   readable
  //     .pipe(writable)
  //     .on('error', (err) => aborted = err)

  //   writable.destroy(new Error('abort'))
  //   await sql.end()

  //   return [
  //     'abort',
  //     aborted.message,
  //     await postgres(options)`drop table test`
  //   ]
  // })

  // t('multiple queries before connect', async() => {
  //   const sql = postgres({ ...options, max: 2 })
  //   const xs = await Promise.all([
  //     sql`select 1 as x`,
  //     sql`select 2 as x`,
  //     sql`select 3 as x`,
  //     sql`select 4 as x`
  //   ])

  //   return [
  //     '1,2,3,4',
  //     xs.map(x => x[0].x).join()
  //   ]
  // })

  // t('subscribe', { timeout: 2 }, async() => {
  //   const sql = postgres({
  //     database: 'bun_sql_test',
  //     publications: 'alltables'
  //   })

  //   await sql.unsafe('create publication alltables for all tables')

  //   const result = []

  //   const { unsubscribe } = await sql.subscribe('*', (row, { command, old }) => {
  //     result.push(command, row.name, row.id, old && old.name, old && old.id)
  //   })

  //   await sql`
  //     create table test (
  //       id serial primary key,
  //       name text
  //     )
  //   `

  //   await sql`alter table test replica identity default`
  //   await sql`insert into test (name) values ('Murray')`
  //   await sql`update test set name = 'Rothbard'`
  //   await sql`update test set id = 2`
  //   await sql`delete from test`
  //   await sql`alter table test replica identity full`
  //   await sql`insert into test (name) values ('Murray')`
  //   await sql`update test set name = 'Rothbard'`
  //   await sql`delete from test`
  //   await delay(10)
  //   await unsubscribe()
  //   await sql`insert into test (name) values ('Oh noes')`
  //   await delay(10)
  //   return [
  //     'insert,Murray,1,,,update,Rothbard,1,,,update,Rothbard,2,,1,delete,,2,,,insert,Murray,2,,,update,Rothbard,2,Murray,2,delete,Rothbard,2,,', // eslint-disable-line
  //     result.join(','),
  //     await sql`drop table test`,
  //     await sql`drop publication alltables`,
  //     await sql.end()
  //   ]
  // })

  // t('subscribe with transform', { timeout: 2 }, async() => {
  //   const sql = postgres({
  //     transform: {
  //       column: {
  //         from: postgres.toCamel,
  //         to: postgres.fromCamel
  //       }
  //     },
  //     database: 'bun_sql_test',
  //     publications: 'alltables'
  //   })

  //   await sql.unsafe('create publication alltables for all tables')

  //   const result = []

  //   const { unsubscribe } = await sql.subscribe('*', (row, { command, old }) =>
  //     result.push(command, row.nameInCamel || row.id, old && old.nameInCamel)
  //   )

  //   await sql`
  //     create table test (
  //       id serial primary key,
  //       name_in_camel text
  //     )
  //   `

  //   await sql`insert into test (name_in_camel) values ('Murray')`
  //   await sql`update test set name_in_camel = 'Rothbard'`
  //   await sql`delete from test`
  //   await sql`alter table test replica identity full`
  //   await sql`insert into test (name_in_camel) values ('Murray')`
  //   await sql`update test set name_in_camel = 'Rothbard'`
  //   await sql`delete from test`
  //   await delay(10)
  //   await unsubscribe()
  //   await sql`insert into test (name_in_camel) values ('Oh noes')`
  //   await delay(10)
  //   return [
  //     'insert,Murray,,update,Rothbard,,delete,1,,insert,Murray,,update,Rothbard,Murray,delete,Rothbard,',
  //     result.join(','),
  //     await sql`drop table test`,
  //     await sql`drop publication alltables`,
  //     await sql.end()
  //   ]
  // })

  // t('subscribe reconnects and calls onsubscribe', { timeout: 4 }, async() => {
  //   const sql = postgres({
  //     database: 'bun_sql_test',
  //     publications: 'alltables',
  //     fetch_types: false
  //   })

  //   await sql.unsafe('create publication alltables for all tables')

  //   const result = []
  //   let onsubscribes = 0

  //   const { unsubscribe, sql: subscribeSql } = await sql.subscribe(
  //     '*',
  //     (row, { command, old }) => result.push(command, row.name || row.id, old && old.name),
  //     () => onsubscribes++
  //   )

  //   await sql`
  //     create table test (
  //       id serial primary key,
  //       name text
  //     )
  //   `

  //   await sql`insert into test (name) values ('Murray')`
  //   await delay(10)
  //   await subscribeSql.close()
  //   await delay(500)
  //   await sql`delete from test`
  //   await delay(100)
  //   await unsubscribe()
  //   return [
  //     '2insert,Murray,,delete,1,',
  //     onsubscribes + result.join(','),
  //     await sql`drop table test`,
  //     await sql`drop publication alltables`,
  //     await sql.end()
  //   ]
  // })

  // t('Execute', async() => {
  //   const result = await new Promise((resolve) => {
  //     const sql = postgres({ ...options, fetch_types: false, debug:(id, query) => resolve(query) })
  //     sql`select 1`.execute()
  //   })

  //   return [result, 'select 1']
  // })

  // t('Cancel running query', async() => {
  //   const query = sql`select pg_sleep(2)`
  //   setTimeout(() => query.cancel(), 200)
  //   const error = await query.catch(x => x)
  //   return ['57014', error.code]
  // })

  // t('Cancel piped query', { timeout: 5 }, async() => {
  //   await sql`select 1`
  //   const last = sql`select pg_sleep(1)`.execute()
  //   const query = sql`select pg_sleep(2) as dig`
  //   setTimeout(() => query.cancel(), 500)
  //   const error = await query.catch(x => x)
  //   await last
  //   return ['57014', error.code]
  // })

  // t('Cancel queued query', async() => {
  //   const query = sql`select pg_sleep(2) as nej`
  //   const tx = sql.begin(sql => (
  //     query.cancel(),
  //     sql`select pg_sleep(0.5) as hej, 'hejsa'`
  //   ))
  //   const error = await query.catch(x => x)
  //   await tx
  //   return ['57014', error.code]
  // })

  // t('Fragments', async() => [
  //   1,
  //   (await sql`
  //     ${ sql`select` } 1 as x
  //   `)[0].x
  // ])

  // t('Result becomes array', async() => [
  //   true,
  //   (await sql`select 1`).slice() instanceof Array
  // ])

  // t('Describe', async() => {
  //   const type = (await sql`select ${ 1 }::int as x`.describe()).types[0]
  //   return [23, type]
  // })

  // t('Describe a statement', async() => {
  //   await sql`create table tester (name text, age int)`
  //   const r = await sql`select name, age from tester where name like $1 and age > $2`.describe()
  //   return [
  //     '25,23/name:25,age:23',
  //     `${ r.types.join(',') }/${ r.columns.map(c => `${c.name}:${c.type}`).join(',') }`,
  //     await sql`drop table tester`
  //   ]
  // })

  // t('Include table oid and column number in column details', async() => {
  //   await sql`create table tester (name text, age int)`
  //   const r = await sql`select name, age from tester where name like $1 and age > $2`.describe()
  //   const [{ oid }] = await sql`select oid from pg_class where relname = 'tester'`

  //   return [
  //     `table:${oid},number:1|table:${oid},number:2`,
  //     `${ r.columns.map(c => `table:${c.table},number:${c.number}`).join('|') }`,
  //     await sql`drop table tester`
  //   ]
  // })

  // t('Describe a statement without parameters', async() => {
  //   await sql`create table tester (name text, age int)`
  //   const r = await sql`select name, age from tester`.describe()
  //   return [
  //     '0,2',
  //     `${ r.types.length },${ r.columns.length }`,
  //     await sql`drop table tester`
  //   ]
  // })

  // t('Describe a statement without columns', async() => {
  //   await sql`create table tester (name text, age int)`
  //   const r = await sql`insert into tester (name, age) values ($1, $2)`.describe()
  //   return [
  //     '2,0',
  //     `${ r.types.length },${ r.columns.length }`,
  //     await sql`drop table tester`
  //   ]
  // })

  // t('Large object', async() => {
  //   const file = rel('index.js')
  //       , md5 = crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

  //   const lo = await sql.largeObject()
  //   await new Promise(async r => fs.createReadStream(file).pipe(await lo.writable()).on('finish', r))
  //   await lo.seek(0)

  //   const out = crypto.createHash('md5')
  //   await new Promise(r => lo.readable().then(x => x.on('data', x => out.update(x)).on('end', r)))

  //   return [
  //     md5,
  //     out.digest('hex'),
  //     await lo.close()
  //   ]
  // })

  // t('Catches type serialize errors', async() => {
  //   const sql = postgres({
  //     idle_timeout,
  //     types: {
  //       text: {
  //         from: 25,
  //         to: 25,
  //         parse: x => x,
  //         serialize: () => { throw new Error('watSerialize') }
  //       }
  //     }
  //   })

  //   return [
  //     'watSerialize',
  //     (await sql`select ${ 'wat' }`.catch(e => e.message))
  //   ]
  // })

  // t('Catches type parse errors', async() => {
  //   const sql = postgres({
  //     idle_timeout,
  //     types: {
  //       text: {
  //         from: 25,
  //         to: 25,
  //         parse: () => { throw new Error('watParse') },
  //         serialize: x => x
  //       }
  //     }
  //   })

  //   return [
  //     'watParse',
  //     (await sql`select 'wat'`.catch(e => e.message))
  //   ]
  // })

  // t('Catches type serialize errors in transactions', async() => {
  //   const sql = postgres({
  //     idle_timeout,
  //     types: {
  //       text: {
  //         from: 25,
  //         to: 25,
  //         parse: x => x,
  //         serialize: () => { throw new Error('watSerialize') }
  //       }
  //     }
  //   })

  //   return [
  //     'watSerialize',
  //     (await sql.begin(sql => (
  //       sql`select 1`,
  //       sql`select ${ 'wat' }`
  //     )).catch(e => e.message))
  //   ]
  // })

  // t('Catches type parse errors in transactions', async() => {
  //   const sql = postgres({
  //     idle_timeout,
  //     types: {
  //       text: {
  //         from: 25,
  //         to: 25,
  //         parse: () => { throw new Error('watParse') },
  //         serialize: x => x
  //       }
  //     }
  //   })

  //   return [
  //     'watParse',
  //     (await sql.begin(sql => (
  //       sql`select 1`,
  //       sql`select 'wat'`
  //     )).catch(e => e.message))
  //   ]
  // })

  // t('Prevent premature end of connection in transaction', async() => {
  //   const sql = postgres({ max_lifetime: 0.01, idle_timeout })
  //   const result = await sql.begin(async sql => {
  //     await sql`select 1`
  //     await delay(20)
  //     await sql`select 1`
  //     return 'yay'
  //   })

  //   return [
  //     'yay',
  //     result
  //   ]
  // })

  // t('Ensure reconnect after max_lifetime with transactions', { timeout: 5 }, async() => {
  //   const sql = postgres({
  //     max_lifetime: 0.01,
  //     idle_timeout,
  //     max: 1
  //   })

  //   let x = 0
  //   while (x++ < 10) await sql.begin(sql => sql`select 1 as x`)

  //   return [true, true]
  // })

  // t('Custom socket', {}, async() => {
  //   let result
  //   const sql = postgres({
  //     socket: () => new Promise((resolve, reject) => {
  //       const socket = new net.Socket()
  //       socket.connect(5432)
  //       socket.once('data', x => result = x[0])
  //       socket.on('error', reject)
  //       socket.on('connect', () => resolve(socket))
  //     }),
  //     idle_timeout
  //   })

  //   await sql`select 1`

  //   return [
  //     result,
  //     82
  //   ]
  // })

  // t('Ensure drain only dequeues if ready', async() => {
  //   const sql = postgres(options)

  //   const res = await Promise.all([
  //     sql.unsafe('SELECT 0+$1 --' + '.'.repeat(100000), [1]),
  //     sql.unsafe('SELECT 0+$1+$2+$3', [1, 2, 3])
  //   ])

  //   return [res.length, 2]
  // })

  // t('Supports fragments as dynamic parameters', async() => {
  //   await sql`create table test (a int, b bool)`
  //   await sql`insert into test values(1, true)`
  //   await sql`insert into test ${
  //     sql({
  //       a: 2,
  //       b: sql`exists(select 1 from test where b = ${ true })`
  //     })
  //   }`

  //   return [
  //     '1,t2,t',
  //     (await sql`select * from test`.raw()).join(''),
  //     await sql`drop table test`
  //   ]
  // })

  // t('Supports nested fragments with parameters', async() => {
  //   await sql`create table test ${
  //     sql`(${ sql('a') } ${ sql`int` })`
  //   }`
  //   await sql`insert into test values(1)`
  //   return [
  //     1,
  //     (await sql`select a from test`)[0].a,
  //     await sql`drop table test`
  //   ]
  // })

  // t('Supports multiple nested fragments with parameters', async() => {
  //   const [{ b }] = await sql`select * ${
  //     sql`from ${
  //       sql`(values (2, ${ 1 }::int)) as x(${ sql(['a', 'b']) })`
  //     }`
  //   }`
  //   return [
  //     1,
  //     b
  //   ]
  // })

  // t('Supports arrays of fragments', async() => {
  //   const [{ x }] = await sql`
  //     ${ [sql`select`, sql`1`, sql`as`, sql`x`] }
  //   `

  //   return [
  //     1,
  //     x
  //   ]
  // })

  // t('Does not try rollback when commit errors', async() => {
  //   let notice = null
  //   const sql = postgres({ ...options, onnotice: x => notice = x })
  //   await sql`create table test(x int constraint test_constraint unique deferrable initially deferred)`

  //   await sql.begin('isolation level serializable', async sql => {
  //     await sql`insert into test values(1)`
  //     await sql`insert into test values(1)`
  //   }).catch(e => e)

  //   return [
  //     notice,
  //     null,
  //     await sql`drop table test`
  //   ]
  // })

  // t('Last keyword used even with duplicate keywords', async() => {
  //   await sql`create table test (x int)`
  //   await sql`insert into test values(1)`
  //   const [{ x }] = await sql`
  //     select
  //       1 in (1) as x
  //     from test
  //     where x in ${ sql([1, 2]) }
  //   `

  //   return [x, true, await sql`drop table test`]
  // })

  // Hangs with array
  test.todo("Insert array with null", async () => {
    await sql`create table test (x int[])`;
    console.log("here");
    try {
      await sql`insert into test ${sql({ x: [1, null, 3] })}`;
      expect((await sql`select x from test`)[0].x[0]).toBe(1);
    } finally {
      await sql`drop table test`;
    }
  });

  // t('Insert array with undefined throws', async() => {
  //   await sql`create table test (x int[])`
  //   return [
  //     'UNDEFINED_VALUE',
  //     await sql`insert into test ${ sql({ x: [1, undefined, 3] }) }`.catch(e => e.code),
  //     await sql`drop table test`
  //   ]
  // })

  // t('Insert array with undefined transform', async() => {
  //   const sql = postgres({ ...options, transform: { undefined: null } })
  //   await sql`create table test (x int[])`
  //   await sql`insert into test ${ sql({ x: [1, undefined, 3] }) }`
  //   return [
  //     1,
  //     (await sql`select x from test`)[0].x[0],
  //     await sql`drop table test`
  //   ]
  // })

  // t('concurrent cursors', async() => {
  //   const xs = []

  //   await Promise.all([...Array(7)].map((x, i) => [
  //     sql`select ${ i }::int as a, generate_series(1, 2) as x`.cursor(([x]) => xs.push(x.a + x.x))
  //   ]).flat())

  //   return ['12233445566778', xs.join('')]
  // })

  // t('concurrent cursors multiple connections', async() => {
  //   const sql = postgres({ ...options, max: 2 })
  //   const xs = []

  //   await Promise.all([...Array(7)].map((x, i) => [
  //     sql`select ${ i }::int as a, generate_series(1, 2) as x`.cursor(([x]) => xs.push(x.a + x.x))
  //   ]).flat())

  //   return ['12233445566778', xs.sort().join('')]
  // })

  test("reserve connection", async () => {
    const sql = postgres({ ...options, max: 1 });
    const reserved = await sql.reserve();

    setTimeout(() => reserved.release(), 510);

    const xs = await Promise.all([
      reserved`select 1 as x`.then(([{ x }]) => ({ time: Date.now(), x })),
      sql`select 2 as x`.then(([{ x }]) => ({ time: Date.now(), x })),
      reserved`select 3 as x`.then(([{ x }]) => ({ time: Date.now(), x })),
    ]);

    if (xs[1].time - xs[2].time < 500) throw new Error("Wrong time");

    expect(xs.map(x => x.x).join("")).toBe("123");
  });

  test("keeps process alive when it should", async () => {
    const file = path.posix.join(__dirname, "sql-fixture-ref.ts");
    const result = await $`DATABASE_URL=${process.env.DATABASE_URL} ${bunExe()} ${file}`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().split("\n")).toEqual(["1", "2", ""]);
  });
}
