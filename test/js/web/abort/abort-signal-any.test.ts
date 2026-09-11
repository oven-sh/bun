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

});
