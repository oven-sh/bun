# Docker Compose Test Infrastructure

## What is Docker Compose?

Docker Compose is a tool for defining and running multi-container Docker applications. Think of it as a "recipe book" that tells Docker exactly how to set up all the services your tests need (databases, message queues, etc.) with a single command.

### Why Use Docker Compose Instead of Plain Docker?

**Without Docker Compose (the old way):**
```javascript
// Each test file manages its own container
const container = await Bun.spawn({
  cmd: ["docker", "run", "-d", "-p", "0:5432", "postgres:15"],
  // ... complex setup
});
// Problems:
// - Each test starts its own container (slow!)
// - Containers might use conflicting ports
// - No coordination between tests
// - Containers are killed after each test (wasteful)
```

**With Docker Compose (the new way):**
```javascript
// All tests share managed containers
const postgres = await dockerCompose.ensure("postgres_plain");
// Benefits:
// - Container starts only once and is reused
// - Automatic port management (no conflicts)
// - All services defined in one place
// - Containers persist across test runs (fast!)
```

## Benefits of This Setup

### 1. **Speed** 🚀
- Containers start once and stay running
- Tests run 10-100x faster (no container startup overhead)
- Example: PostgreSQL tests went from 30s to 3s

### 2. **No Port Conflicts** 🔌
- Docker Compose assigns random available ports automatically
- No more "port already in use" errors
- Multiple developers can run tests simultaneously

### 3. **Centralized Configuration** 📝
- All services defined in one `docker-compose.yml` file
- Easy to update versions, add services, or change settings
- No need to hunt through test files to find container configs

### 4. **Lazy Loading** 💤
- Services only start when actually needed
- Running MySQL tests? Only MySQL starts
- Saves memory and CPU

### 5. **Better CI/CD** 🔄
- Predictable, reproducible test environments
- Same setup locally and in CI
- Easy to debug when things go wrong

## How It Works

### The Setup

1. **docker-compose.yml** - Defines all test services:
```yaml
services:
  postgres_plain:
    image: postgres:15
    environment:
      POSTGRES_HOST_AUTH_METHOD: trust
    ports:
      - target: 5432      # Container's port
        published: 0      # 0 = let Docker pick a random port
```

2. **index.ts** - TypeScript helper for managing services:
```typescript
// Start a service (if not already running)
const info = await dockerCompose.ensure("postgres_plain");
// Returns: { host: "127.0.0.1", ports: { 5432: 54321 } }
//                                         ^^^^ random port Docker picked
```

3. **Test Integration**:
```typescript
import * as dockerCompose from "../../docker/index.ts";

test("database test", async () => {
  const pg = await dockerCompose.ensure("postgres_plain");
  const client = new PostgresClient({
    host: pg.host,
    port: pg.ports[5432],  // Use the mapped port
  });
  // ... run tests
});
```

## Available Services

| Service | Description | Ports | Special Features |
|---------|-------------|-------|------------------|
| **PostgreSQL** | | | |
| `postgres_plain` | Basic PostgreSQL | 5432 | No auth required |
| `postgres_tls` | PostgreSQL with TLS | 5432 | SSL certificates included |
| `postgres_auth` | PostgreSQL with auth | 5432 | Username/password required |
| **MySQL** | | | |
| `mysql_plain` | Basic MySQL | 3306 | Root user, no password |
| `mysql_native_password` | MySQL with legacy auth | 3306 | For compatibility testing |
| `mysql_tls` | MySQL with TLS | 3306 | SSL certificates included |
| **Redis/Valkey** | | | |
| `redis_unified` | Redis with all features | 6379 (TCP), 6380 (TLS) | Persistence, Unix sockets, ACLs |
| **S3/MinIO** | | | |
| `minio` | S3-compatible storage | 9000 (API), 9001 (Console) | AWS S3 API testing |
| **WebSocket** | | | |
| `autobahn` | WebSocket test suite | 9002 | 517 conformance tests |

## Usage Examples

### Basic Usage

```typescript
import * as dockerCompose from "../../docker/index.ts";

test("connect to PostgreSQL", async () => {
  // Ensure PostgreSQL is running (starts if needed)
  const pg = await dockerCompose.ensure("postgres_plain");

  // Connect using the provided info
  const connectionString = `postgres://postgres@${pg.host}:${pg.ports[5432]}/postgres`;
  // ... run your tests
});
```

### Multiple Services

```typescript
test("copy data between databases", async () => {
  // Start both services
  const [pg, mysql] = await Promise.all([
    dockerCompose.ensure("postgres_plain"),
    dockerCompose.ensure("mysql_plain"),
  ]);

  // Use both in your test
  const pgClient = connectPostgres(pg.ports[5432]);
  const mysqlClient = connectMySQL(mysql.ports[3306]);
  // ... test data transfer
});
```

### With Health Checks

```typescript
test("wait for service to be healthy", async () => {
  const redis = await dockerCompose.ensure("redis_unified");

  // Optional: Wait for service to be ready
  await dockerCompose.waitTcp(redis.host, redis.ports[6379], 30000);

  // Now safe to connect
  const client = new RedisClient(`redis://${redis.host}:${redis.ports[6379]}`);
});
```

## Architecture

```
test/docker/
├── docker-compose.yml       # Service definitions
├── index.ts                # TypeScript API
├── prepare-ci.sh          # CI/CD setup script
├── README.md              # This file
├── config/                # Service configurations
│   ├── fuzzingserver.json # Autobahn config
│   └── ...
└── init-scripts/          # Database initialization
    ├── postgres-init.sql
    └── ...
```

## How Services Stay Running

Docker Compose keeps services running between test runs:

1. **First test run**: Container starts (takes a few seconds)
2. **Subsequent runs**: Container already running (instant)
3. **After tests finish**: Container keeps running
4. **Manual cleanup**: `docker-compose down` when done

This is different from the old approach where every test started and stopped its own container.

## Debugging

### View Running Services
```bash
cd test/docker
docker-compose ps
```

### Check Service Logs
```bash
docker-compose logs postgres_plain
```

### Stop All Services
```bash
docker-compose down
```

### Remove Everything (Including Data)
```bash
docker-compose down -v  # -v removes volumes too
```

### Connection Issues?
```bash
# Check if service is healthy
docker-compose ps
# Should show "Up" status

# Test connection manually
docker exec -it docker-postgres_plain-1 psql -U postgres
```

## Advanced Features

### Unix Domain Sockets

Some services (PostgreSQL, Redis) support Unix domain sockets. The TypeScript helper creates a proxy:

```typescript
// Automatically creates /tmp/proxy_socket that forwards to container
const pg = await dockerCompose.ensure("postgres_plain");
// Connect via: postgresql:///postgres?host=/tmp/proxy_socket
```

### Persistent Data

Some services use volumes to persist data across container restarts:
- Redis: Uses volume for AOF persistence
- PostgreSQL/MySQL: Can be configured with volumes if needed

### Environment Variables

Control behavior with environment variables:
- `COMPOSE_PROJECT_NAME`: Prefix for container names (default: "bun-test-services")
- `BUN_DOCKER_COMPOSE_PATH`: Override docker-compose.yml location

## Migration Guide

If you're migrating tests from direct Docker usage:

1. **Identify services**: Find all `docker run` commands in tests
2. **Add to docker-compose.yml**: Define each service
3. **Update tests**: Replace Docker spawning with `dockerCompose.ensure()`
4. **Test**: Run tests to verify they work
5. **Cleanup**: Remove old Docker management code

Example migration:
```javascript
// OLD
const container = spawn(["docker", "run", "-d", "postgres"]);
const port = /* complex port parsing */;

// NEW
const pg = await dockerCompose.ensure("postgres_plain");
const port = pg.ports[5432];
```

## FAQ

**Q: Do I need to start services manually?**
A: No! `ensure()` starts them automatically if needed.

**Q: What if I need a service not in docker-compose.yml?**
A: Add it to docker-compose.yml and create a PR.

**Q: How do I update a service version?**
A: Edit docker-compose.yml and run `docker-compose pull`.

**Q: Can I run tests in parallel?**
A: Yes! Each service can handle multiple connections.

**Q: What about test isolation?**
A: Tests should create unique databases/keys/buckets for isolation.

**Q: Why port 0 in docker-compose.yml?**
A: This tells Docker to pick any available port, preventing conflicts.

## Best Practices

1. **Always use dynamic ports**: Set `published: 0` for automatic port assignment
2. **Use health checks**: Add healthcheck configurations for reliable startup
3. **Clean up in tests**: Delete test data after each test (but keep containers running)
4. **Prefer ensure()**: Always use `dockerCompose.ensure()` instead of assuming services are running
5. **Handle failures gracefully**: Services might fail to start; handle errors appropriately

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Connection refused" | Service might still be starting. Add `waitTcp()` or increase timeout |
| "Port already in use" | Another service using the port. Use dynamic ports (`published: 0`) |
| "Container not found" | Run `docker-compose up -d SERVICE_NAME` manually |
| Tests suddenly slow | Containers might have been stopped. Check with `docker-compose ps` |
| "Permission denied" | Docker daemon might require sudo. Check Docker installation |

## Contributing

To add a new service:

1. Add service definition to `docker-compose.yml`
2. Use dynamic ports unless specific port required
3. Add health check if possible
4. Document in this README
5. Add example test
6. Submit PR

Remember: The goal is to make tests fast, reliable, and easy to run!