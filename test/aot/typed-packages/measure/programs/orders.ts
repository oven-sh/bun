import { total } from "orders";
import { run } from "../turns";

const lines = Number(process.argv[2]);
const json = JSON.stringify({
  lines: Array.from({ length: lines }, (_, index) => ({ price: (199 + (index % 900) * 7) / 100, count: 1 + (index % 7) })),
});

await run(() => String(total(json)));
