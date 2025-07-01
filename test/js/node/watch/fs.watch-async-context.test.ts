import { test, expect } from "bun:test";
import { AsyncLocalStorage } from "async_hooks";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";

test("fs.watch preserves AsyncLocalStorage context", async () => {
  const asyncLocalStorage = new AsyncLocalStorage();
  const testFile = path.join(tmpdir(), "test-watch-async-context.txt");
  
  // Create test file
  fs.writeFileSync(testFile, "initial content");
  
  try {
    const contextValue = { userId: "user123", requestId: "req456" };
    
    const promise = new Promise<void>((resolve, reject) => {
      asyncLocalStorage.run(contextValue, () => {
        const watcher = fs.watch(testFile, (eventType, filename) => {
          try {
            // Check if AsyncLocalStorage context is preserved
            const context = asyncLocalStorage.getStore() as typeof contextValue;
            expect(context).toEqual(contextValue);
            expect(context.userId).toBe("user123");
            expect(context.requestId).toBe("req456");
            
            watcher.close();
            resolve();
          } catch (error) {
            watcher.close();
            reject(error);
          }
        });
        
        // Trigger the watcher by modifying the file
        setTimeout(() => {
          fs.writeFileSync(testFile, "modified content");
        }, 10);
      });
    });
    
    await promise;
  } finally {
    // Clean up
    try {
      fs.unlinkSync(testFile);
    } catch {}
  }
});

test("fs.watch without AsyncLocalStorage context", async () => {
  const asyncLocalStorage = new AsyncLocalStorage();
  const testFile = path.join(tmpdir(), "test-watch-no-context.txt");
  
  // Create test file
  fs.writeFileSync(testFile, "initial content");
  
  try {
    const promise = new Promise<void>((resolve, reject) => {
      // Set up watcher outside of AsyncLocalStorage context
      const watcher = fs.watch(testFile, (eventType, filename) => {
        try {
          // Should have no context
          const context = asyncLocalStorage.getStore();
          expect(context).toBeUndefined();
          
          watcher.close();
          resolve();
        } catch (error) {
          watcher.close();
          reject(error);
        }
      });
      
      // Trigger the watcher by modifying the file
      setTimeout(() => {
        fs.writeFileSync(testFile, "modified content");
      }, 10);
    });
    
    await promise;
  } finally {
    // Clean up
    try {
      fs.unlinkSync(testFile);
    } catch {}
  }
});

test("fs.watch nested AsyncLocalStorage context", async () => {
  const asyncLocalStorage = new AsyncLocalStorage();
  const testFile = path.join(tmpdir(), "test-watch-nested-context.txt");
  
  // Create test file
  fs.writeFileSync(testFile, "initial content");
  
  try {
    const outerContext = { level: "outer", value: 1 };
    const innerContext = { level: "inner", value: 2 };
    
    const promise = new Promise<void>((resolve, reject) => {
      asyncLocalStorage.run(outerContext, () => {
        asyncLocalStorage.run(innerContext, () => {
          const watcher = fs.watch(testFile, (eventType, filename) => {
            try {
              // Should preserve the inner context
              const context = asyncLocalStorage.getStore() as typeof innerContext;
              expect(context).toEqual(innerContext);
              expect(context.level).toBe("inner");
              expect(context.value).toBe(2);
              
              watcher.close();
              resolve();
            } catch (error) {
              watcher.close();
              reject(error);
            }
          });
          
          // Trigger the watcher by modifying the file
          setTimeout(() => {
            fs.writeFileSync(testFile, "modified content");
          }, 10);
        });
      });
    });
    
    await promise;
  } finally {
    // Clean up
    try {
      fs.unlinkSync(testFile);
    } catch {}
  }
});