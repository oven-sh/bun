// TODO - bun has no `send` method in the process
const out = { env: { ...process.env } };
process?.send(out);
