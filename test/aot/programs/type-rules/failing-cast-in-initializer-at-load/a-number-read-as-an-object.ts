type Config = { inner: { size: number } };
function hold(config: Config): { held: { size: number } } { return { held: config.inner }; }
export const made = hold({ inner: 5 } as unknown as Config);
