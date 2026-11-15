import { vi } from "bun:test";
import { expectType } from "./utilities";

expectType<typeof vi>(vi.stubEnv("NODE_ENV", "production"));
vi.stubEnv("NODE_ENV", undefined).stubEnv("DEV", true).stubEnv("PROD", undefined);
// @ts-expect-error
vi.stubEnv("NODE_ENV", true);
// @ts-expect-error
vi.stubEnv("SSR", "true");
expectType<typeof vi>(vi.unstubAllEnvs());

expectType<typeof vi>(vi.stubGlobal("fetch", () => {}));
vi.stubGlobal(Symbol.iterator, 1).stubGlobal(0, undefined);
// @ts-expect-error
vi.stubGlobal("fetch");
expectType<typeof vi>(vi.unstubAllGlobals());

expectType<void>(vi.setConfig({ testTimeout: 1000, hookTimeout: 1000, sequence: { hooks: "stack" } }));
vi.setConfig({ testTimeout: undefined });
// @ts-expect-error
vi.setConfig({ testTimeout: "1000" });
vi.setConfig({
  maxConcurrency: 2,
  clearMocks: false,
  mockReset: true,
  restoreMocks: true,
  unstubEnvs: true,
  unstubGlobals: true,
});
// @ts-expect-error
vi.setConfig({ clearMocks: "yes" });
// @ts-expect-error
vi.setConfig();
expectType<void>(vi.resetConfig());

expectType<Promise<void>>(vi.dynamicImportSettled());

expectType<Promise<number>>(vi.waitFor(() => 1));
expectType<Promise<number>>(vi.waitFor(async () => 1, 100));
expectType<Promise<string | null>>(vi.waitFor((): string | null => null, { timeout: 100, interval: undefined }));
// @ts-expect-error
vi.waitFor(() => 1, { timeout: "100" });
// @ts-expect-error
vi.waitFor(1);

expectType<Promise<string>>(vi.waitUntil((): string | null | undefined | false | 0 => null));
expectType<Promise<true>>(vi.waitUntil(async (): Promise<boolean> => true, { interval: 10 }));
expectType<Promise<number>>(vi.waitUntil((): number => 1, 100));
// @ts-expect-error
vi.waitUntil(() => 1, null);
