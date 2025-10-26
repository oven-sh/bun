/**
 * Shared types and utilities for telemetry tests
 *
 * This module re-exports types from @bun/otel/types to provide a single,
 * consistent import point for all telemetry test files.
 *
 * Usage:
 *   import { InstrumentKind } from "./shared";
 *
 *   const id = Bun.telemetry.attach({
 *     type: InstrumentKind.HTTP,
 *     name: "test",
 *     version: "1.0.0",
 *     onOperationStart: () => {},
 *   });
 */

import { NativeInstrument } from "bun";

// export { ConfigurationProperty, InstrumentKind } from "bun-otel";

// TODO - codegen or figure out a better way to share these!

/**
 * Numeric enum mapping to Zig InstrumentKind enum values.
 *
 * Used internally for type-safe mapping between string literals (public API)
 * and numeric values (Zig FFI). DO NOT export from package.
 *
 * Maps 1:1 with src/bun.js/telemetry.zig InstrumentKind enum.
 */
export enum InstrumentKind {
  Custom = 0,
  HTTP = 1,
  Fetch = 2,
  SQL = 3,
  Redis = 4,
  S3 = 5,
  NODE_HTTP = 6,
}

/**
 * Numeric enum for configuration property identifiers.
 *
 * Used to access header capture/propagation configuration via nativeHooks.
 * Maps 1:1 with src/bun.js/telemetry.zig ConfigurationProperty enum.
 *
 * @internal
 */
export enum ConfigurationProperty {
  /** Reserved (always undefined) */
  RESERVED = 0,
  /** HTTP server request headers to capture */
  http_capture_headers_server_request = 1,
  /** HTTP server response headers to capture */
  http_capture_headers_server_response = 2,
  /** HTTP server response headers to inject/propagate */
  http_propagate_headers_server_response = 3,
  /** Fetch client request headers to capture */
  http_capture_headers_fetch_request = 4,
  /** Fetch client response headers to capture */
  http_capture_headers_fetch_response = 5,
  /** Fetch client request headers to inject/propagate */
  http_propagate_headers_fetch_request = 6,
}

// Compact local copy of Bun.telemetry.internal (mirrors bun-otel/types.ts) for tests.
declare global {
  namespace Bun {
    namespace telemetry {
      export function listInstruments(kind?: InstrumentKind | number): Array<{
        id: number;
        name: string;
        version: string;
        kind: InstrumentKind;
      }>;

      export type NativeInstrumentInternal = Omit<NativeInstrument, "type"> & {
        type: number | string;
      };

      export function attach(instrument: NativeInstrumentInternal): {
        id: number;
        [Symbol.dispose](): void;
        dispose(): void;
      };

      export function nativeHooks(): {
        isEnabledFor(kind: number): boolean;
        notifyStart(kind: number, id: number, attributes: Record<string, any>): void;
        notifyEnd(kind: number, id: number, attributes: Record<string, any>): void;
        notifyError(kind: number, id: number, attributes: Record<string, any>): void;
        notifyProgress(kind: number, id: number, attributes: Record<string, any>): void;
        notifyInject(kind: number, id: number, data?: Record<string, any>): any[];
        getConfigurationProperty(propertyId: number): any;
        setConfigurationProperty(propertyId: number, value: any): void;
        getInjectHeaders(kind: number): { request: string[]; response: string[] } | null;
      };
    }
  }
}
type NII = Bun.telemetry.NativeInstrumentInternal;
export type { NII as NativeInstrumentInternal };
/**
 * Helper class for automatic cleanup of attached instruments using `using` statement.
 *
 * @example
 * ```typescript
 * test("example", () => {
 *   using instrument = new InstrumentRef({
 *     type: InstrumentKind.HTTP,
 *     name: "test",
 *     version: "1.0.0",
 *     onOperationStart: () => {},
 *   });
 *
 *   // instrument.id is available for assertions
 *   expect(instrument.id).toBeGreaterThan(0);
 *
 *   // automatically calls Bun.telemetry.detach(id) when leaving scope
 * });
 * ```
 */
export class InstrumentRef implements Disposable {
  readonly id: number;
  private ref: any;

  constructor(instrument: any) {
    // attach() returns an object with { id, [Symbol.dispose](), dispose() }
    this.ref = Bun.telemetry.attach(instrument);
    this.id = this.ref.id;
  }

  [Symbol.dispose]() {
    // Use the native Symbol.dispose from the returned object
    this.ref[Symbol.dispose]();
  }
}

export function getNativeHooks(): {
  isEnabledFor(kind: number): boolean;
  notifyStart(kind: number, id: number, attributes: Record<string, any>): void;
  notifyEnd(kind: number, id: number, attributes: Record<string, any>): void;
  notifyError(kind: number, id: number, attributes: Record<string, any>): void;
  notifyProgress(kind: number, id: number, attributes: Record<string, any>): void;
  notifyInject(kind: number, id: number, data?: Record<string, any>): any[];
  getConfigurationProperty(propertyId: number): any;
  setConfigurationProperty(propertyId: number, value: any): void;
  getInjectHeaders(kind: number): { request: string[]; response: string[] } | null;
} {
  const hooks = Bun.telemetry.nativeHooks();
  return hooks;
}

export {}; // ensure this file is a module so global augmentation applies
