import * as bun from "bun:test";

export type ModuleDetail = "bun" | `bun:${string}` | "node" | `node:${string}`;
export type IssueDetail = `https://github.com/oven-sh/bun/issues/${number}`;
export type SkipDetail = boolean | string;
export type OsDetail = "linux" | "darwin" | "windows" | "posix";
export type ArchDetail = "x64" | "x64-baseline" | "aarch64";
export type PlatformDetail = OsDetail | ArchDetail | `${OsDetail}-${ArchDetail}`;

export type TestOptions = {
  /**
   * Identifiers for the test.
   */

  label?: string;
  module?: ModuleDetail;
  issue?: IssueDetail;

  /**
   * Reasons that a test should be skipped.
   */

  skip?: SkipDetail;
  todo?: SkipDetail;
  flaky?: SkipDetail;
  broken?: SkipDetail;

  prototype?: string;
  property?: string;
  function?: string;

  /**
   * If the test should be run on a specific platform.
   */
  os?: PlatformDetail | PlatformDetail[];

  /**
   * If the result of the test is known at compile time.
   */
  comptime?: boolean;

  /**
   * If this test should be run with a baseline build.
   */
  baseline?: boolean;

  /**
   * If the test requires resources to verify the correctness
   * of the result, which does not need to be run on every test run.
   */
  exhaustive?: boolean;

  /**
   * If the tests requires that a specific command is available.
   */
  command?: string | string[];
};

export function test(label: string | TestOptions | (() => unknown), fn?: () => unknown): void {}

export function describe(label: string | TestOptions, fn: () => unknown): void {}
