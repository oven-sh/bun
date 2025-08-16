import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("Bun.experimental_processStorage basic functionality", () => {
  const storage = Bun.experimental_processStorage;

  // Clear any existing data
  storage.clear();

  // Test setItem and getItem
  storage.setItem("test-key", "test-value");
  expect(storage.getItem("test-key")).toBe("test-value");

  // Test null return for non-existent key
  expect(storage.getItem("non-existent")).toBe(null);

  // Test removeItem
  storage.setItem("to-remove", "will-be-removed");
  expect(storage.getItem("to-remove")).toBe("will-be-removed");
  storage.removeItem("to-remove");
  expect(storage.getItem("to-remove")).toBe(null);

  // Test clear
  storage.setItem("key1", "value1");
  storage.setItem("key2", "value2");
  storage.clear();
  expect(storage.getItem("key1")).toBe(null);
  expect(storage.getItem("key2")).toBe(null);
});

test("Bun.experimental_processStorage string conversion", () => {
  const storage = Bun.experimental_processStorage;
  storage.clear();

  // Test with numbers
  storage.setItem("number", 42);
  expect(storage.getItem("number")).toBe("42");

  // Test with boolean
  storage.setItem("bool", true);
  expect(storage.getItem("bool")).toBe("true");

  // Test with object (toString conversion)
  storage.setItem("object", { key: "value" });
  expect(storage.getItem("object")).toBe("[object Object]");

  storage.clear();
});

test("Bun.experimental_processStorage edge cases", () => {
  const storage = Bun.experimental_processStorage;
  storage.clear();

  // Test with empty string
  storage.setItem("empty", "");
  expect(storage.getItem("empty")).toBe("");

  // Test with spaces
  storage.setItem("spaces", "  value with spaces  ");
  expect(storage.getItem("spaces")).toBe("  value with spaces  ");

  // Test with special characters
  storage.setItem("special", "value\nwith\tspecial\rchars");
  expect(storage.getItem("special")).toBe("value\nwith\tspecial\rchars");

  // Test with unicode
  storage.setItem("unicode", "🔥💯✨");
  expect(storage.getItem("unicode")).toBe("🔥💯✨");

  storage.clear();
});

test("Bun.experimental_processStorage process isolation", async () => {
  const storage = Bun.experimental_processStorage;
  storage.clear();

  // Set some data in current process
  storage.setItem("current-process-key", "current-process-value");

  const dir = tempDirWithFiles("process-storage-test", {
    "test.js": `
      const storage = Bun.experimental_processStorage;
      console.log(JSON.stringify({
        // Should be null since this is a separate process
        currentProcessValue: storage.getItem("current-process-key"),
        // Should work within this process
        newValue: (() => {
          storage.setItem("new-key", "new-value");
          return storage.getItem("new-key");
        })()
      }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  const result = JSON.parse(stdout.trim());
  // Process storage is isolated per process
  expect(result.currentProcessValue).toBe(null);
  // But works within the same process
  expect(result.newValue).toBe("new-value");

  // Verify our current process still has its data
  expect(storage.getItem("current-process-key")).toBe("current-process-value");
  // But not the data from the subprocess
  expect(storage.getItem("new-key")).toBe(null);

  storage.clear();
});

test("Bun.experimental_processStorage concurrent access", async () => {
  const storage = Bun.experimental_processStorage;
  storage.clear();

  const dir = tempDirWithFiles("process-storage-concurrent", {
    "worker.js": `
      onmessage = (event) => {
        if (event.data === "start") {
          const storage = Bun.experimental_processStorage;
          
          // Read existing value
          const existing = storage.getItem("shared-key");
          
          // Set worker-specific value
          storage.setItem("worker-key", "worker-value");
          
          // Modify shared value
          storage.setItem("shared-key", "modified-by-worker");
          
          postMessage({
            existing,
            workerValue: storage.getItem("worker-key"),
            sharedValue: storage.getItem("shared-key")
          });
        }
      };
    `,
    "main.js": `
      const storage = Bun.experimental_processStorage;
      
      // Set initial value
      storage.setItem("shared-key", "initial-value");
      
      const worker = new Worker("./worker.js");
      
      worker.postMessage("start");
      
      const result = await new Promise(resolve => {
        worker.onmessage = (event) => {
          resolve(event.data);
        };
      });
      
      console.log(JSON.stringify({
        workerSawInitial: result.existing,
        workerSetValue: result.workerValue,
        workerModifiedShared: result.sharedValue,
        mainSeesWorkerKey: storage.getItem("worker-key"),
        mainSeesSharedModification: storage.getItem("shared-key")
      }));
      
      worker.terminate();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  const result = JSON.parse(stdout.trim());
  expect(result.workerSawInitial).toBe("initial-value");
  expect(result.workerSetValue).toBe("worker-value");
  expect(result.workerModifiedShared).toBe("modified-by-worker");
  expect(result.mainSeesWorkerKey).toBe("worker-value");
  expect(result.mainSeesSharedModification).toBe("modified-by-worker");

  storage.clear();
});

test("Bun.experimental_processStorage getOrSetItem", () => {
  const storage = Bun.experimental_processStorage;
  storage.clear();
  
  // Test setting a new item
  const result1 = storage.getOrSetItem("new-key", "default-value");
  expect(result1).toBe("default-value");
  expect(storage.getItem("new-key")).toBe("default-value");
  
  // Test getting an existing item (should not overwrite)
  storage.setItem("existing-key", "existing-value");
  const result2 = storage.getOrSetItem("existing-key", "new-default");
  expect(result2).toBe("existing-value");
  expect(storage.getItem("existing-key")).toBe("existing-value");
  
  // Test with type conversion
  const result3 = storage.getOrSetItem("number-key", 42);
  expect(result3).toBe("42");
  expect(storage.getItem("number-key")).toBe("42");
  
  storage.clear();
});

test("Bun.experimental_processStorage takeItem", () => {
  const storage = Bun.experimental_processStorage;
  storage.clear();
  
  // Test taking a non-existent item
  const result1 = storage.takeItem("non-existent");
  expect(result1).toBe(null);
  
  // Test taking an existing item
  storage.setItem("to-take", "take-me");
  const result2 = storage.takeItem("to-take");
  expect(result2).toBe("take-me");
  
  // Verify item was removed
  expect(storage.getItem("to-take")).toBe(null);
  
  // Test taking the same item again (should be null)
  const result3 = storage.takeItem("to-take");
  expect(result3).toBe(null);
  
  // Test with multiple items
  storage.setItem("item1", "value1");
  storage.setItem("item2", "value2");
  
  const taken1 = storage.takeItem("item1");
  expect(taken1).toBe("value1");
  expect(storage.getItem("item1")).toBe(null);
  expect(storage.getItem("item2")).toBe("value2"); // Should still exist
  
  storage.clear();
});
