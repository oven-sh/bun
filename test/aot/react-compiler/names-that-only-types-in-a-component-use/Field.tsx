import { limits, type Change } from "./types";

interface Row { id: number }

export function Field({ rows, label }: { rows: unknown[]; label: string }) {
  const first = rows[0] as Row;
  const most: (typeof limits)["most"] = 3;
  const describe = (change: Change) => change.value + most;
  return <p title={label}>{describe({ value: String(first.id) })}</p>;
}
