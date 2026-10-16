type Config = { size: number };
function next(config: Config): { size: number } { return { size: config.size + 1 }; }
export const made = next({ size: "s" } as unknown as Config);
