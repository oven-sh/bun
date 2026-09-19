import { expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { includePath, lines, run, supported, wrapperSource } from "./run-fixtures";

// A miscompile check on real code: SQLite (the amalgamation in this repository, 260,000 lines of C) is compiled by
// Bun's C compiler, linked with a small driver and asked questions with known answers.
// `bun build --compile` takes no -D or -I: each file is compiled through a wrapper that defines the macros and
// includes it, and the directory of "sqlite3_local.h" (the amalgamation's header) goes in C_INCLUDE_PATH.
const sqlite = join(import.meta.dir, "../../../../../src/jsc/bindings/sqlite");

test.skipIf(!supported)("SQLite runs queries in memory", async () => {
  const queries: [string, string][] = [
    [
      "select sqlite_version() >= '3.40', 1 + 2 * 3, 7 / 2, 7.0 / 2, 'a' || 'b', upper('hello'), abs(-5)",
      "1|7|3|3.5|ab|HELLO|5\n",
    ],
    [
      "create table t(id integer primary key, name text, score real); insert into t(name, score) values ('ann', 9.5), ('bob', 7.25), ('cy', 8.0), ('di', NULL)",
      "",
    ],
    ["select name, score from t where score > 7.5 order by score desc", "ann|9.5\ncy|8.0\n"],
    [
      "select count(*), count(score), sum(score), avg(score), max(name), group_concat(name, ',') from t",
      "4|3|24.75|8.25|di|ann,bob,cy,di\n",
    ],
    [
      "with recursive n(x) as (select 1 union all select x + 1 from n where x < 100) select sum(x), sum(x * x), count(*) from n",
      "5050|338350|100\n",
    ],
    [
      "create index by_name on t(name); select id from t where name = 'cy'; update t set score = score * 2 where id <= 2; select printf('%.2f', sum(score)) from t",
      "3\n41.50\n",
    ],
    [
      `select json_extract('{"a":[1,2,{"b":42}]}', '$.a[2].b'), json_array(1, 'x', null), round(sqrt(2), 6), 0x7fffffffffffffff + 0, -9223372036854775807 - 1`,
      '42|[1,"x",null]|1.414214|9223372036854775807|-9223372036854775808\n',
    ],
    [
      "select typeof(1), typeof(1.0), typeof('x'), typeof(x'00'), typeof(null), hex(zeroblob(2) || x'ff'), substr('hello', 2, 3), instr('hello', 'll'), replace('aXbX', 'X', '--'), like('a%', 'abc'), glob('a*c', 'abc')",
      "integer|real|text|blob|null|0000FF|ell|3|a--b--|1|1\n",
    ],
    ["select * from nowhere", "error: no such table: nowhere"],
    [
      "begin; insert into t(name) select 'n' || x from (with recursive n(x) as (select 1 union all select x + 1 from n where x < 500) select x from n); commit; select count(*), min(id), max(id) from t",
      "504|1|504\n",
    ],
    [
      "select name from t where name like 'n49%' order by id",
      "n49\nn490\nn491\nn492\nn493\nn494\nn495\nn496\nn497\nn498\nn499\n",
    ],
    [
      "create virtual table docs using fts5(body); insert into docs values ('the quick brown fox'), ('lazy dogs sleep'), ('quick thinking'); select rowid from docs where docs match 'quick' order by rowid",
      "1\n3\n",
    ],
    ["pragma integrity_check", "ok\n"],
  ];
  // (Under Microsoft C SQLite guards its memory-mapped WAL with __try, which needs unwinding this compiler has not got.)
  const defines = [
    "SQLITE_OMIT_SEH=1",
    "SQLITE_THREADSAFE=0",
    "SQLITE_OMIT_LOAD_EXTENSION=1",
    "SQLITE_DEFAULT_MEMSTATUS=0",
    "SQLITE_ENABLE_MATH_FUNCTIONS=1",
    "SQLITE_ENABLE_JSON1=1",
    "SQLITE_ENABLE_FTS5=1",
    "SQLITE_ENABLE_RTREE=1",
  ];
  const driver = `#include "sqlite3_local.h"
#include <string.h>
#include <stdio.h>
static sqlite3 *db;
static char out[4096];
static int collect(void *unused, int n, char **values, char **names) {
  (void)unused; (void)names;
  for (int i = 0; i < n; i++) { strcat(out, values[i] ? values[i] : "NULL"); strcat(out, i + 1 < n ? "|" : "\\n"); }
  return 0;
}
static const char *query(const char *sql) {
  char *message = 0;
  out[0] = 0;
  if (sqlite3_exec(db, sql, collect, 0, &message) != SQLITE_OK) snprintf(out, sizeof out, "error: %s", message);
  return out;
}
int main(void) {
  static const char *const queries[] = { ${queries.map(([sql]) => JSON.stringify(sql)).join(",\n    ")} };
  if (sqlite3_open(":memory:", &db)) return 1;
  for (int i = 0; i < ${queries.length}; i++) printf("[%d]%s", i, query(queries[i]));
  return 0;
}
`;
  using dir = tempDir("bir-sqlite", {
    "main.c": wrapperSource(defines, "driver.c"),
    "driver.c": driver,
    "sqlite3.c": wrapperSource(defines, join(sqlite, "sqlite3.c")),
  });
  const program = join(String(dir), isWindows ? "program.exe" : "program");
  const env = { ...bunEnv, C_INCLUDE_PATH: includePath(sqlite) };
  const build = await run(String(dir), ["build", "--compile", "main.c", "sqlite3.c", "--outfile", program], env);
  expect(build.stderr).not.toContain("error:");
  expect(build.exitCode).toBe(0);
  await using proc = Bun.spawn({ cmd: [program], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(lines(stdout), stderr).toBe(queries.map(([, result], index) => `[${index}]${result}`).join(""));
  expect(exitCode).toBe(0);
});
