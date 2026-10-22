async function load(label: string, run: () => Promise<string>): Promise<void> {
  try {
    console.log(label + ": " + (await run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

await load("base first", async () => (await import("./base.ts")).viaDerived());
await load("base again", async () => (await import("./base.ts")).viaDerived());
await load("derived afterwards", async () => (await import("./derived.ts")).describeDerived());

export {};
