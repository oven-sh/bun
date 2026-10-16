// The docker-compose services a test can ask for: the keys under `services:`
// in docker-compose.yml. This module has no imports and is an .mts file, so
// that plain Node (scripts/docker-services.ts) and bun (index.ts,
// coordinator.ts) both load it as an ES module.
export const serviceNames = [
  "postgres_plain",
  "postgres_tls",
  "postgres_auth",
  "mysql_plain",
  "mysql_native_password",
  "mysql_tls",
  "mariadb_plain",
  "redis_plain",
  "redis_unified",
  "autobahn",
  "squid",
] as const;

export type ServiceName = (typeof serviceNames)[number];

const names: ReadonlySet<string> = new Set(serviceNames);
export const isServiceName = (name: string): name is ServiceName => names.has(name);
