import { test, expect } from "bun:test";
import { SQL } from "bun";
import { bunEnv } from "harness";

// Skip test if PostgreSQL is not available
const isPostgresAvailable = () => {
  try {
    const result = Bun.spawnSync({
      cmd: ["pg_isready", "-h", "localhost"],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
};

test.skipIf(!isPostgresAvailable())("PostgreSQL TIME and TIMETZ types are handled correctly", async () => {
  const db = new SQL("postgres://postgres@localhost/postgres");
  
  try {
    // Create test table with time and timetz columns
    await db`DROP TABLE IF EXISTS bun_time_test`;
    await db`
      CREATE TABLE bun_time_test (
        id SERIAL PRIMARY KEY,
        regular_time TIME,
        time_with_tz TIMETZ
      )
    `;

    // Insert test data with various time values
    await db`
      INSERT INTO bun_time_test (regular_time, time_with_tz) VALUES 
        ('09:00:00', '09:00:00+00'),
        ('10:30:45.123456', '10:30:45.123456-05'),
        ('23:59:59.999999', '23:59:59.999999+08:30'),
        ('00:00:00', '00:00:00-12:00'),
        (NULL, NULL)
    `;

    // Query the data
    const result = await db`
      SELECT 
        id,
        regular_time,
        time_with_tz
      FROM bun_time_test
      ORDER BY id
    `;

    // Verify that time values are returned as strings, not binary data
    expect(result[0].regular_time).toBe("09:00:00");
    expect(result[0].time_with_tz).toBe("09:00:00+00");
    
    expect(result[1].regular_time).toBe("10:30:45.123456");
    expect(result[1].time_with_tz).toBe("10:30:45.123456-05");
    
    expect(result[2].regular_time).toBe("23:59:59.999999");
    expect(result[2].time_with_tz).toBe("23:59:59.999999+08:30");
    
    expect(result[3].regular_time).toBe("00:00:00");
    expect(result[3].time_with_tz).toBe("00:00:00-12");
    
    // NULL values
    expect(result[4].regular_time).toBeNull();
    expect(result[4].time_with_tz).toBeNull();
    
    // None of the values should contain null bytes
    for (const row of result) {
      if (row.regular_time) {
        expect(row.regular_time).not.toContain("\u0000");
        expect(typeof row.regular_time).toBe("string");
      }
      if (row.time_with_tz) {
        expect(row.time_with_tz).not.toContain("\u0000");
        expect(typeof row.time_with_tz).toBe("string");
      }
    }

    // Clean up
    await db`DROP TABLE bun_time_test`;
  } finally {
    await db.end();
  }
});

test.skipIf(!isPostgresAvailable())("PostgreSQL TIME array types are handled correctly", async () => {
  const db = new SQL("postgres://postgres@localhost/postgres");
  
  try {
    // Create test table with time array
    await db`DROP TABLE IF EXISTS bun_time_array_test`;
    await db`
      CREATE TABLE bun_time_array_test (
        id SERIAL PRIMARY KEY,
        time_values TIME[],
        timetz_values TIMETZ[]
      )
    `;

    // Insert test data
    await db`
      INSERT INTO bun_time_array_test (time_values, timetz_values) VALUES 
        (ARRAY['09:00:00'::time, '17:00:00'::time], ARRAY['09:00:00+00'::timetz, '17:00:00-05'::timetz]),
        (ARRAY['10:30:00'::time, '18:30:00'::time, '20:00:00'::time], ARRAY['10:30:00+02'::timetz]),
        (NULL, NULL),
        (ARRAY[]::time[], ARRAY[]::timetz[])
    `;

    const result = await db`
      SELECT 
        id,
        time_values,
        timetz_values
      FROM bun_time_array_test
      ORDER BY id
    `;

    // Verify array values
    expect(result[0].time_values).toEqual(["09:00:00", "17:00:00"]);
    expect(result[0].timetz_values).toEqual(["09:00:00+00", "17:00:00-05"]);
    
    expect(result[1].time_values).toEqual(["10:30:00", "18:30:00", "20:00:00"]);
    expect(result[1].timetz_values).toEqual(["10:30:00+02"]);
    
    expect(result[2].time_values).toBeNull();
    expect(result[2].timetz_values).toBeNull();
    
    expect(result[3].time_values).toEqual([]);
    expect(result[3].timetz_values).toEqual([]);

    // Ensure no binary data in arrays
    for (const row of result) {
      if (row.time_values && Array.isArray(row.time_values)) {
        for (const time of row.time_values) {
          expect(typeof time).toBe("string");
          expect(time).not.toContain("\u0000");
        }
      }
      if (row.timetz_values && Array.isArray(row.timetz_values)) {
        for (const time of row.timetz_values) {
          expect(typeof time).toBe("string");
          expect(time).not.toContain("\u0000");
        }
      }
    }

    // Clean up
    await db`DROP TABLE bun_time_array_test`;
  } finally {
    await db.end();
  }
});

test.skipIf(!isPostgresAvailable())("PostgreSQL TIME in nested structures (JSONB) works correctly", async () => {
  const db = new SQL("postgres://postgres@localhost/postgres");
  
  try {
    await db`DROP TABLE IF EXISTS bun_time_json_test`;
    await db`
      CREATE TABLE bun_time_json_test (
        id SERIAL PRIMARY KEY,
        schedule JSONB
      )
    `;

    // Insert test data with times in JSONB
    await db`
      INSERT INTO bun_time_json_test (schedule) VALUES 
        ('{"dayOfWeek": 1, "timeBlocks": [{"startTime": "09:00:00", "endTime": "17:00:00"}]}'::jsonb),
        ('{"dayOfWeek": 2, "timeBlocks": [{"startTime": "10:30:00", "endTime": "18:30:00"}]}'::jsonb)
    `;

    const result = await db`
      SELECT 
        id,
        schedule
      FROM bun_time_json_test
      ORDER BY id
    `;

    // Verify JSONB with time strings
    expect(result[0].schedule.dayOfWeek).toBe(1);
    expect(result[0].schedule.timeBlocks[0].startTime).toBe("09:00:00");
    expect(result[0].schedule.timeBlocks[0].endTime).toBe("17:00:00");
    
    expect(result[1].schedule.dayOfWeek).toBe(2);
    expect(result[1].schedule.timeBlocks[0].startTime).toBe("10:30:00");
    expect(result[1].schedule.timeBlocks[0].endTime).toBe("18:30:00");

    // Clean up
    await db`DROP TABLE bun_time_json_test`;
  } finally {
    await db.end();
  }
});