console.log(typeof Bun.version, typeof Bun.revision, Bun.main.length > 0, Bun.isMainThread, typeof Bun.env.PATH, Bun.argv.length > 0, typeof Bun.cwd, typeof Bun.origin);
await new Promise(resolve => setTimeout(resolve, 1));
