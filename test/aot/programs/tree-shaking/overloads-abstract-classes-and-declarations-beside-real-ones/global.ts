function real() { return "provided by global.ts"; }
(globalThis as any).providedElsewhere = real;
