// Maps test-path prefixes to the docker services those tests need. Keys are
// paths relative to test/ using "/" separators, prefix-matched. Two consumers
// must agree on it, which is why it lives in its own module:
//   - test/docker/coordinator.ts starts every mapped service for the shard at
//     launch, so containers are (ideally) healthy before the first request.
//   - scripts/runner.node.ts orders matching test files toward the end of the
//     shard, so container cold-start (~10s for mysqld) overlaps with the
//     non-docker tests that run first instead of being paid as wall time
//     inside the first docker test's beforeAll.
// All matching prefixes add up. test/internal/prestart-map.test.ts fails when a
// test file asks for a service the map does not give it.
export const prestartMap = {
  "js/sql/sql-mysql": ["mysql_plain", "mariadb_plain"],
  "js/sql/sql-mysql.test": ["mysql_native_password", "mysql_tls"],
  "js/sql/sql-mysql.auth": ["mysql_native_password"],
  "js/sql/sql-mariadb": ["mariadb_plain"],
  "js/sql/sql-empty-column-name": ["mysql_plain", "mariadb_plain"],
  "js/sql/sql-errors": ["postgres_plain", "mysql_plain"],
  "js/sql/sql-handles-servers": ["postgres_plain", "mysql_plain", "mariadb_plain"],
  "js/sql/sql-hot-reload": ["postgres_plain", "mysql_plain"],
  "js/sql/sql-onconnect-onclose-throw": ["postgres_plain", "mysql_plain", "mariadb_plain"],
  "js/sql/sql-pool.test": ["postgres_plain", "mysql_plain", "mariadb_plain"],
  "js/sql/sql-query-building": ["postgres_plain", "mysql_plain", "mariadb_plain"],
  "js/sql/sql-result-columns": ["postgres_plain", "mysql_plain", "mariadb_plain"],
  "js/sql/sql-transform": ["postgres_plain", "mysql_plain", "mariadb_plain"],
  "js/sql/sql-statement-cache-hash-collision": ["postgres_plain", "mysql_plain"],
  "js/sql/tls-sql": ["postgres_tls"],
  "js/sql/sql-tls-server-identity": ["postgres_tls", "mysql_tls"],
  "js/sql/local-sql": ["postgres_tls"],
  "js/sql/sql.test": ["postgres_plain"],
  "js/sql/sql-begin-commit-rolled-back": ["postgres_plain"],
  "js/sql/sql-postgres-datetime": ["postgres_plain"],
  "js/sql/sql-prepare-false": ["postgres_plain"],
  "js/sql/sql-reserve-abort": ["postgres_plain"],
  "js/sql/postgres-array-params": ["postgres_plain"],
  "js/sql/postgres-auth": ["postgres_auth", "postgres_tls"],
  "js/sql/postgres-bind-encode-throw": ["postgres_plain"],
  "js/sql/postgres-bind.test": ["postgres_plain"],
  "js/sql/postgres-bytea-bind": ["postgres_plain"],
  "js/sql/postgres-connection": ["postgres_plain", "postgres_tls"],
  "js/sql/postgres-copy": ["postgres_plain", "postgres_tls"],
  "js/sql/postgres-datestyle": ["postgres_plain"],
  "js/sql/postgres-decode": ["postgres_plain"],
  "js/sql/postgres-dispatch": ["postgres_plain"],
  "js/sql/postgres-listen-notify": ["postgres_plain"],
  "js/sql/postgres-multi-statement-fields": ["postgres_plain"],
  "js/sql/postgres-prepared-pipeline-reorder": ["postgres_plain"],
  "js/sql/postgres-row-decode-error": ["postgres_plain"],
  "js/sql/postgres-simple-query-pipeline": ["postgres_plain"],
  "js/valkey/": ["redis_unified"],
  "js/web/websocket/autobahn": ["autobahn"],
  "js/web/websocket/websocket-proxy": ["squid"],
  "integration/mysql2/": ["mysql_plain", "mysql_native_password"],
  "regression/issue/21311": ["postgres_plain"],
  "regression/issue/24850": ["mysql_plain"],
  "regression/issue/26030": ["mysql_plain"],
  "regression/issue/26063": ["mysql_plain"],
  "regression/issue/28632": ["mysql_plain"],
};
