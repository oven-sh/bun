/**
 * For implementers of packages/bun-otel BunSqliteInstrumentation:
 *
 * Example events received by the instrumentation:
 *
 * onOperationStart(id: 1, attributes: {
 *   "operation.id": 1,
 *   "operation.timestamp": 1761374115357274000,
 *   "db.system.name": "sqlite",
 *   "db.namespace": "/path/to/db.db"
 * })
 *
 * onOperationProgress(id: 1, attributes: {
 *   "operation.timestamp": 1761374115358628000,
 *   "operation.duration": 0,
 *   "db.system.name": "sqlite",
 *   "db.namespace": "/path/to/db.db",
 *   "db.query.text": "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
 *   "db.operation.name": "CREATE",
 *   "db.query.summary": "CREATE"
 * })
 *
 * onOperationEnd(id: 1, attributes: {})
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";

const DEBUG_SQL_HOOK = false;

const debugLog = (...args: any[]) => {
  if (DEBUG_SQL_HOOK) console.log(...args);
};

/**
 * SQLite Telemetry with sqlite3_trace_v2
 *
 * Architecture:
 * - Uses SQLite's built-in sqlite3_trace_v2() API for automatic query profiling
 * - One operation ID per database connection (monotonic ID generated when DB opens)
 * - No manual instrumentation needed - SQLite handles all query lifecycle events
 *
 * Event Flow:
 * 1. onOperationStart → Fired when new Database() is called
 *    - operation.id: Monotonic ID (unique per connection, consistent across all events)
 *    - db.system.name: "sqlite"
 *    - db.namespace: Database file path
 *
 * 2. onOperationProgress → Fired for each query execution (via SQLITE_TRACE_PROFILE)
 *    - db.query.text: Full SQL query text
 *    - db.operation.name: SQL operation (SELECT, INSERT, UPDATE, etc.)
 *    - db.collection.name: Table name (extracted from query)
 *    - db.query.summary: Low-cardinality summary (e.g., "INSERT orders")
 *    - operation.duration: Query execution time in nanoseconds (from SQLite)
 *
 * 3. onOperationEnd → Fired when db.close() is called (via SQLITE_TRACE_CLOSE)
 *    - Empty attributes (just signals database closure)
 */
describe("SQLite Telemetry", () => {
  test("captures SQL query execution with telemetry hooks", () => {
    using dir = tempDir("sql-telemetry", {});
    const dbPath = `${dir}/test.db`;
    let startCalled = false;
    let progressCalled = false;
    let endCalled = false;
    let startAttrs: any = null;
    let progressAttrs: any = null;
    let endAttrs: any = null;

    // @ts-ignore - Internal telemetry API
    using attached = Bun.telemetry.attach({
      kind: "sql",
      name: "test-sql-instrumentation",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        debugLog("START CALLED", id, attributes);
        startCalled = true;
        startAttrs = attributes;
      },
      onOperationProgress(id: number, attributes: any) {
        debugLog("PROGRESS CALLED", id, attributes);
        progressCalled = true;
        progressAttrs = attributes;
      },
      onOperationEnd(id: number, attributes: any) {
        debugLog("END CALLED", id, attributes);
        endCalled = true;
        endAttrs = attributes;
      },
    });

    debugLog("Attached result:", attached);

    using db = new Database(dbPath);
    debugLog("Database created");

    // Start should be called when DB opens
    expect(startCalled).toBe(true);
    expect(startAttrs).toMatchObject({
      "db.system.name": "sqlite",
      "db.namespace": dbPath,
    });

    db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    debugLog("Query executed, progressCalled:", progressCalled);

    // Progress should be called for the query
    expect(progressCalled).toBe(true);
    expect(progressAttrs).toMatchObject({
      "db.operation.name": "CREATE",
      "db.query.text": expect.stringContaining("CREATE TABLE"),
    });

    // Database will be auto-closed by 'using' keyword
    // End should be called when DB closes
    // Note: We need to manually trigger disposal to check endCalled before test ends
    db[Symbol.dispose]();
    debugLog("Database closed, endCalled:", endCalled);

    expect(endCalled).toBe(true);
  });

  test.skip("captures SQL error with telemetry hooks", () => {
    using dir = tempDir("sql-telemetry-error", {});
    const dbPath = `${dir}/test-error.db`;
    let errorCalled = false;
    let errorAttrs: any = null;

    // @ts-ignore - Internal telemetry API
    using attached = Bun.telemetry.attach({
      kind: "sql",
      name: "test-sql-error-instrumentation",
      version: "1.0.0",
      onOperationError(id: number, attributes: any) {
        errorCalled = true;
        errorAttrs = attributes;
      },
    });

    using db = new Database(dbPath);
    db.run("CREATE TABLE users (email TEXT UNIQUE)");
    db.run("INSERT INTO users (email) VALUES (?)", ["test@example.com"]);

    // Try to insert duplicate email (should trigger UNIQUE constraint error)
    try {
      db.run("INSERT INTO users (email) VALUES (?)", ["test@example.com"]);
    } catch (err) {
      // Expected error
    }

    expect(errorCalled).toBe(true);
    expect(errorAttrs).toMatchObject({
      "error.type": "SQLITE_CONSTRAINT",
      "error.message": expect.stringContaining("UNIQUE"),
      "db.response.status_code": "19",
      "operation.duration": expect.any(Number),
    });

    // Database will be auto-closed by 'using' keyword
  });

  test("captures query summary and operation name", () => {
    using dir = tempDir("sql-telemetry-summary", {});
    const dbPath = `${dir}/test-summary.db`;
    let progressAttrs: any[] = [];

    // @ts-ignore - Internal telemetry API
    using attached = Bun.telemetry.attach({
      kind: "sql",
      name: "test-sql-summary",
      version: "1.0.0",
      onOperationProgress(id: number, attributes: any) {
        progressAttrs.push(attributes);
      },
    });

    using db = new Database(dbPath);
    db.run("CREATE TABLE orders (id INTEGER, total REAL)");
    db.run("INSERT INTO orders (id, total) VALUES (1, 99.99)");

    // Should have progress for both queries
    expect(progressAttrs.length).toBeGreaterThanOrEqual(2);

    // Check the INSERT query attributes
    const insertAttrs = progressAttrs.find(a => a["db.operation.name"] === "INSERT");
    expect(insertAttrs).toMatchObject({
      "db.operation.name": "INSERT",
      "db.collection.name": "orders",
      "db.query.summary": "INSERT orders",
    });

    // Database will be auto-closed by 'using' keyword
  });

  test("handles multiple databases with separate operation IDs", () => {
    using dir = tempDir("sql-telemetry-multi", {});
    const dbPath1 = `${dir}/db1.db`;
    const dbPath2 = `${dir}/db2.db`;

    const events: Array<{ event: string; id: number; attrs: any }> = [];

    // @ts-ignore - Internal telemetry API
    using attached = Bun.telemetry.attach({
      kind: "sql",
      name: "test-multi-db",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        events.push({ event: "start", id, attrs: attributes });
      },
      onOperationProgress(id: number, attributes: any) {
        events.push({ event: "progress", id, attrs: attributes });
      },
      onOperationEnd(id: number, attributes: any) {
        events.push({ event: "end", id, attrs: attributes });
      },
    });

    // Open two databases
    using db1 = new Database(dbPath1);
    using db2 = new Database(dbPath2);

    // Get the operation IDs from the start events
    const startEvents = events.filter(e => e.event === "start");
    expect(startEvents.length).toBe(2);

    const db1Id = startEvents.find(e => e.attrs["db.namespace"] === dbPath1)!.id;
    const db2Id = startEvents.find(e => e.attrs["db.namespace"] === dbPath2)!.id;

    // Operation IDs should be different (each DB gets its own monotonic ID)
    expect(db1Id).not.toBe(db2Id);
    expect(db1Id).toBeGreaterThan(0);
    expect(db2Id).toBeGreaterThan(0);

    // Execute queries on both databases
    db1.run("CREATE TABLE users (id INTEGER, name TEXT)");
    db2.run("CREATE TABLE products (id INTEGER, price REAL)");

    // Check that progress events have the correct operation IDs
    const progressEvents = events.filter(e => e.event === "progress");
    expect(progressEvents.length).toBe(2);

    const db1Progress = progressEvents.find(e => e.id === db1Id);
    const db2Progress = progressEvents.find(e => e.id === db2Id);

    expect(db1Progress).toBeDefined();
    expect(db1Progress!.attrs["db.query.text"]).toContain("users");

    expect(db2Progress).toBeDefined();
    expect(db2Progress!.attrs["db.query.text"]).toContain("products");

    // Manually dispose to check end events before test ends
    db1[Symbol.dispose]();
    db2[Symbol.dispose]();

    // Check that end events have the correct operation IDs
    const endEvents = events.filter(e => e.event === "end");
    expect(endEvents.length).toBe(2);
    expect(endEvents.map(e => e.id).sort()).toEqual([db1Id, db2Id].sort());
  });
});
