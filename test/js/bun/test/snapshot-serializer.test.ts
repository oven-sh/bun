import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("expect.addSnapshotSerializer", () => {
  test("should serialize custom objects with print function", async () => {
    using dir = tempDir("snapshot-serializer-print", {
      "test.test.js": `
import { test, expect } from "bun:test";

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

expect.addSnapshotSerializer({
  test(val) {
    return val instanceof Point;
  },
  print(val) {
    return \`Point(\${val.x}, \${val.y})\`;
  }
});

test("snapshot with custom serializer", () => {
  const point = new Point(10, 20);
  expect(point).toMatchSnapshot();
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js", "--update-snapshots"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("panic");
    expect(exitCode).toBe(0);

    // Check that snapshot file was created with custom serialization
    const snapshotContent = await Bun.file(`${dir}/__snapshots__/test.test.js.snap`).text();
    expect(snapshotContent).toContain("Point(10, 20)");
  });

  test("should serialize custom objects with serialize function", async () => {
    using dir = tempDir("snapshot-serializer-serialize", {
      "test.test.js": `
import { test, expect } from "bun:test";

class Vector {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

expect.addSnapshotSerializer({
  test(val) {
    return val instanceof Vector;
  },
  serialize(val) {
    return \`<Vector x=\${val.x} y=\${val.y} z=\${val.z}>\`;
  }
});

test("snapshot with serialize function", () => {
  const vec = new Vector(1, 2, 3);
  expect(vec).toMatchSnapshot();
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js", "--update-snapshots"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("panic");
    expect(exitCode).toBe(0);

    const snapshotContent = await Bun.file(`${dir}/__snapshots__/test.test.js.snap`).text();
    expect(snapshotContent).toContain("<Vector x=1 y=2 z=3>");
  });

  test("should use most recently added serializer first", async () => {
    using dir = tempDir("snapshot-serializer-order", {
      "test.test.js": `
import { test, expect } from "bun:test";

class MyClass {
  constructor(value) {
    this.value = value;
  }
}

expect.addSnapshotSerializer({
  test(val) {
    return val instanceof MyClass;
  },
  print(val) {
    return \`FirstSerializer(\${val.value})\`;
  }
});

expect.addSnapshotSerializer({
  test(val) {
    return val instanceof MyClass;
  },
  print(val) {
    return \`SecondSerializer(\${val.value})\`;
  }
});

test("uses most recent serializer", () => {
  const obj = new MyClass("test");
  expect(obj).toMatchSnapshot();
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js", "--update-snapshots"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("panic");
    expect(exitCode).toBe(0);

    const snapshotContent = await Bun.file(`${dir}/__snapshots__/test.test.js.snap`).text();
    expect(snapshotContent).toContain("SecondSerializer(test)");
    expect(snapshotContent).not.toContain("FirstSerializer");
  });

  test("should fall back to default formatting if test returns false", async () => {
    using dir = tempDir("snapshot-serializer-fallback", {
      "test.test.js": `
import { test, expect } from "bun:test";

expect.addSnapshotSerializer({
  test(val) {
    return false; // Never matches
  },
  print(val) {
    return "SHOULD_NOT_APPEAR";
  }
});

test("uses default formatter", () => {
  expect({ x: 1, y: 2 }).toMatchSnapshot();
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js", "--update-snapshots"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("panic");
    expect(exitCode).toBe(0);

    const snapshotContent = await Bun.file(`${dir}/__snapshots__/test.test.js.snap`).text();
    expect(snapshotContent).not.toContain("SHOULD_NOT_APPEAR");
    expect(snapshotContent).toContain("x");
    expect(snapshotContent).toContain("y");
  });

  test("should throw error if serializer is not an object", async () => {
    using dir = tempDir("snapshot-serializer-invalid-object", {
      "test.test.js": `
import { test, expect } from "bun:test";

try {
  expect.addSnapshotSerializer("not an object");
  console.log("FAIL: Should have thrown");
} catch (e) {
  console.log("PASS: Threw error");
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("PASS: Threw error");
  });

  test("should throw error if serializer missing test function", async () => {
    using dir = tempDir("snapshot-serializer-no-test", {
      "test.test.js": `
import { test, expect } from "bun:test";

try {
  expect.addSnapshotSerializer({
    print(val) {
      return String(val);
    }
  });
  console.log("FAIL: Should have thrown");
} catch (e) {
  console.log("PASS: Threw error");
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("PASS: Threw error");
  });

  test("should throw error if serializer missing print/serialize function", async () => {
    using dir = tempDir("snapshot-serializer-no-print", {
      "test.test.js": `
import { test, expect } from "bun:test";

try {
  expect.addSnapshotSerializer({
    test(val) {
      return true;
    }
  });
  console.log("FAIL: Should have thrown");
} catch (e) {
  console.log("PASS: Threw error");
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("PASS: Threw error");
  });

  test("should work with inline snapshots", async () => {
    using dir = tempDir("snapshot-serializer-inline", {
      "test.test.js": `
import { test, expect } from "bun:test";

class Color {
  constructor(r, g, b) {
    this.r = r;
    this.g = g;
    this.b = b;
  }
}

expect.addSnapshotSerializer({
  test(val) {
    return val instanceof Color;
  },
  print(val) {
    return \`rgb(\${val.r}, \${val.g}, \${val.b})\`;
  }
});

test("inline snapshot with serializer", () => {
  const color = new Color(255, 128, 0);
  expect(color).toMatchInlineSnapshot();
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js", "--update-snapshots"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("panic");
    expect(exitCode).toBe(0);

    // Check that the test file was updated with the inline snapshot
    const testContent = await Bun.file(`${dir}/test.test.js`).text();
    expect(testContent).toContain("rgb(255, 128, 0)");
  });

  test("should serialize top-level custom object", async () => {
    using dir = tempDir("snapshot-serializer-toplevel", {
      "test.test.js": `
import { test, expect } from "bun:test";

class Container {
  constructor(items) {
    this.items = items;
  }
}

expect.addSnapshotSerializer({
  test(val) {
    return val instanceof Container;
  },
  print(val) {
    return \`Container[\${val.items.length} items]\`;
  }
});

test("top-level custom serializer", () => {
  const container = new Container([1, 2, 3]);
  expect(container).toMatchSnapshot();
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js", "--update-snapshots"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("panic");
    expect(exitCode).toBe(0);

    const snapshotContent = await Bun.file(`${dir}/__snapshots__/test.test.js.snap`).text();
    expect(snapshotContent).toContain("Container[3 items]");
  });
});
