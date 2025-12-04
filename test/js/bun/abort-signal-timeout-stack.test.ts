import { expect, test, describe } from "bun:test";

describe("AbortSignal.timeout stack trace", () => {
    test("should include stack trace pointing to where AbortSignal.timeout() was called", async () => {
        // This test verifies fix for issue #25182
        // The stack trace should point to where AbortSignal.timeout() was called,
        // not just where the timeout was triggered internally
        
        async function myFunction() {
            const signal = AbortSignal.timeout(50);
            await new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => {
                    reject(signal.reason);
                });
                setTimeout(resolve, 1000);
            });
        }
        
        try {
            await myFunction();
            expect.unreachable("Should have thrown");
        } catch (e: any) {
            expect(e instanceof DOMException).toBe(true);
            expect(e.name).toBe("TimeoutError");
            expect(e.message).toBe("The operation timed out.");
            
            // The stack trace should include 'myFunction' 
            // since that's where AbortSignal.timeout() was called
            const stack = e.stack;
            expect(stack).toBeDefined();
            expect(typeof stack).toBe("string");
            
            // Check that stack trace includes the calling function
            // This is the key fix - previously this would be empty or only have internals
            expect(stack).toInclude("myFunction");
        }
    });
    
    test("stack trace should include the test file name", async () => {
        try {
            const signal = AbortSignal.timeout(10);
            await new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason));
                setTimeout(resolve, 1000);
            });
        } catch (e: any) {
            // Stack should reference this test file
            expect(e.stack).toInclude("abort-signal-timeout-stack.test.ts");
        }
    });
});
