import { work } from "./work.ts";
declare var self: Worker;
self.onmessage = async (e: MessageEvent) => { const lines: string[] = []; for (let i = 0; i < e.data.rounds; i++) { const l = await work(e.data.seed + i); if (i === 0 || i === e.data.rounds - 1) lines.push(...l); if (e.data.gc) Bun.gc(true); } postMessage(lines); };
