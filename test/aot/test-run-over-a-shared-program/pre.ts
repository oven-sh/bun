import { beforeAll, afterEach } from "../harness/declare";
(globalThis as any).preloaded = ((globalThis as any).preloaded ?? 0) + 1;
beforeAll(() => { (globalThis as any).beforeAllRan = true; });
afterEach(() => { (globalThis as any).afterEachCount = ((globalThis as any).afterEachCount ?? 0) + 1; });
