// Maps test-path prefixes to the docker services those tests need. Keys are
// paths relative to test/ using "/" separators, prefix-matched. Two consumers
// must agree on it, which is why it lives in its own module:
//   - test/docker/coordinator.ts starts every mapped service for the shard at
//     launch, so containers are (ideally) healthy before the first request.
//   - scripts/runner.node.mjs orders matching test files toward the end of the
//     shard, so container cold-start (~10s for mysqld) overlaps with the
//     non-docker tests that run first instead of being paid as wall time
//     inside the first docker test's beforeAll.
// The map is hand-maintained; a missing entry just means that test's service
// starts on first request instead of at launch (correct, just slower).
export const prestartMap = {
  "js/sql/sql-mysql": ["mysql_plain", "mysql_native_password", "mysql_tls"],
  "js/sql/tls-sql": ["postgres_tls"],
  "js/sql/local-sql": ["postgres_tls"],
  "js/sql/sql.test": ["postgres_plain"],
  "js/sql/sql-postgres-datetime": ["postgres_plain"],
  "js/sql/postgres-binary-numeric": ["postgres_plain"],
  "js/sql/postgres-multi-statement-fields": ["postgres_plain"],
  "js/sql/postgres-simple-query-pipeline": ["postgres_plain"],
  "js/sql/sql-onconnect-onclose-throw": ["postgres_plain", "mysql_plain"],
  "js/sql/sql-prepare-false": ["postgres_plain"],
  "js/valkey/": ["redis_unified"],
  "js/bun/s3/": ["minio"],
  "js/web/websocket/autobahn": ["autobahn"],
  "js/web/websocket/websocket-proxy": ["squid"],
  "integration/mysql2/": ["mysql_plain", "mysql_native_password"],
  "regression/issue/21311": ["postgres_plain"],
  "regression/issue/24850": ["mysql_plain"],
  "regression/issue/26030": ["mysql_plain"],
  "regression/issue/26063": ["mysql_plain"],
  "regression/issue/28632": ["mysql_plain"],
};
