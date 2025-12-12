import { describe, expect, test } from "bun:test";

/**
 * Comprehensive tests for AbortSignal.any()
 * 
 * AbortSignal.any() creates a composite signal that aborts when any of the
 * provided signals abort. This test suite covers edge cases and ensures
 * standards-compliant behavior.
 */
describe("AbortSignal.any()", () => {
    describe("basic functionality", () => {
        test("should return a non-aborted signal for empty array", () => {
            // @ts-ignore - TypeScript may not have this typed
            const signal = AbortSignal.any([]);
            expect(signal).toBeInstanceOf(AbortSignal);
            expect(signal.aborted).toBe(false);
        });

        test("should follow a single signal", () => {
            const controller = new AbortController();
            // @ts-ignore
            const composite = AbortSignal.any([controller.signal]);

            expect(composite.aborted).toBe(false);
            controller.abort();
            expect(composite.aborted).toBe(true);
        });

        test("should abort when any of multiple signals abort", () => {
            const controller1 = new AbortController();
            const controller2 = new AbortController();
            const controller3 = new AbortController();

            // @ts-ignore
            const composite = AbortSignal.any([
                controller1.signal,
                controller2.signal,
                controller3.signal
            ]);

            expect(composite.aborted).toBe(false);
            controller2.abort("middle signal aborted");
            expect(composite.aborted).toBe(true);
        });
    });

    describe("already-aborted signals", () => {
        test("should immediately abort if any input signal is already aborted", () => {
            const abortedController = new AbortController();
            abortedController.abort("pre-aborted");

            const freshController = new AbortController();

            // @ts-ignore
            const composite = AbortSignal.any([
                freshController.signal,
                abortedController.signal
            ]);

            expect(composite.aborted).toBe(true);
        });

        test("should use AbortSignal.abort() result correctly", () => {
            const alreadyAborted = AbortSignal.abort("already aborted reason");
            const controller = new AbortController();

            // @ts-ignore
            const composite = AbortSignal.any([controller.signal, alreadyAborted]);

            expect(composite.aborted).toBe(true);
            expect(composite.reason).toBe("already aborted reason");
        });

        test("should work with all signals already aborted", () => {
            const aborted1 = AbortSignal.abort("first");
            const aborted2 = AbortSignal.abort("second");

            // @ts-ignore
            const composite = AbortSignal.any([aborted1, aborted2]);

            expect(composite.aborted).toBe(true);
            // First aborted signal's reason should be used
            expect(composite.reason).toBe("first");
        });
    });

    describe("reason propagation", () => {
        // Table-driven tests for different reason types
        const reasonCases = [
            { name: "Error", reason: new Error("custom abort reason") },
            { name: "string", reason: "string reason" },
            { name: "object", reason: { code: 42, message: "custom object" } },
        ];

        test.each(reasonCases)("should propagate $name reasons", ({ reason }) => {
            const controller = new AbortController();
            // @ts-ignore
            const composite = AbortSignal.any([controller.signal]);
            controller.abort(reason);
            expect(composite.reason).toBe(reason);
        });

        test("should use DOMException for default abort reason", () => {
            const controller = new AbortController();
            // @ts-ignore
            const composite = AbortSignal.any([controller.signal]);

            controller.abort();

            expect(composite.reason).toBeInstanceOf(DOMException);
            expect(composite.reason.name).toBe("AbortError");
        });
    });

    describe("event handling", () => {
        test("should fire abort event when composite aborts", async () => {
            const { promise, resolve } = Promise.withResolvers<boolean>();

            const controller = new AbortController();
            // @ts-ignore
            const composite = AbortSignal.any([controller.signal]);

            composite.addEventListener("abort", () => resolve(true));

            // Abort fires synchronously, so the event listener is called before abort() returns
            controller.abort();

            const result = await promise;
            expect(result).toBe(true);
        });

        test("should only fire abort event once even with multiple source aborts", () => {
            let abortCount = 0;

            const controller1 = new AbortController();
            const controller2 = new AbortController();

            // @ts-ignore
            const composite = AbortSignal.any([controller1.signal, controller2.signal]);

            composite.addEventListener("abort", () => abortCount++);

            // Abort events fire synchronously, so no need to wait
            controller1.abort();
            controller2.abort();

            expect(abortCount).toBe(1);
        });
    });

    describe("nested AbortSignal.any()", () => {
        test("should work with nested any() calls", () => {
            const controller1 = new AbortController();
            const controller2 = new AbortController();
            const controller3 = new AbortController();

            // @ts-ignore
            const nested = AbortSignal.any([controller1.signal, controller2.signal]);
            // @ts-ignore
            const composite = AbortSignal.any([nested, controller3.signal]);

            expect(composite.aborted).toBe(false);

            controller2.abort("from nested");

            expect(nested.aborted).toBe(true);
            expect(composite.aborted).toBe(true);
            expect(composite.reason).toBe("from nested");
        });
    });

    describe("with AbortSignal.timeout()", () => {
        test("should work with timeout signals", async () => {
            const controller = new AbortController();
            const timeoutSignal = AbortSignal.timeout(50);

            // @ts-ignore
            const composite = AbortSignal.any([controller.signal, timeoutSignal]);

            expect(composite.aborted).toBe(false);

            // Wait for abort event instead of arbitrary sleep
            const { promise, resolve } = Promise.withResolvers<void>();
            composite.addEventListener("abort", () => resolve());

            await promise;

            expect(composite.aborted).toBe(true);
            expect(composite.reason).toBeInstanceOf(DOMException);
            expect(composite.reason.name).toBe("TimeoutError");
        });

        test("should prefer manual abort over timeout if it comes first", () => {
            const controller = new AbortController();
            const timeoutSignal = AbortSignal.timeout(1000);

            // @ts-ignore
            const composite = AbortSignal.any([controller.signal, timeoutSignal]);

            controller.abort("manual abort");

            expect(composite.aborted).toBe(true);
            expect(composite.reason).toBe("manual abort");
        });
    });
});
