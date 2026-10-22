declare const aotOperationCount: (name: string) => number;
type Span = { start: number; end: number; label: string };
type Mark = { at: number; note: string };
type Message = { content: string; spans?: Span[] };

function measure(label: string, run: () => unknown): void {
  const before = aotOperationCount("operationAOTEnforceType");
  const result = run();
  console.log(label + ": " + JSON.stringify(result) + ": " + (aotOperationCount("operationAOTEnforceType") - before) + " conversions by the runtime");
}

function append(message: Message, added: readonly Span[]): void {
  const base = message.content.length;
  message.spans = [...(message.spans ?? []), ...added.map(span => ({ ...span, start: span.start + base }))];
}

function totalOfMovedMarks(marks: readonly Mark[]): number {
  const moved = marks.map(mark => ({ ...mark, at: mark.at + 1 }));
  let sum = 0;
  for (const mark of moved) sum += mark.at + mark.note.length;
  return sum;
}

function keysOf(value: unknown): string {
  return Object.keys(value as object).join();
}

const spanTexts = [
  '[{"start":1,"end":2,"label":"a"},{"start":3,"end":4,"label":"b"}]',
  '[{"label":"a","end":2,"start":1}]',
  '[{"start":1,"label":"a"}]',
  '[{"start":1,"end":"two","label":"a"}]',
  '[{"label":"a","end":2,"start":1,"extra":true}]',
  '[{"start":1,"end":2,"label":7}]',
  '[{"end":2,"label":"a"}]',
  '[]',
];
for (const text of spanTexts) {
  measure("copies that nothing reads by field, of " + text, () => {
    const message: Message = { content: "abc" };
    const spans: Span[] = JSON.parse(text);
    append(message, spans);
    append(message, spans);
    return [message.spans, message.spans!.map(keysOf)];
  });
}
measure("copies of objects allocated here", () => {
  const message: Message = { content: "abcd" };
  const spans: Span[] = [{ start: 1, end: 2, label: "here" }];
  append(message, spans);
  return [message.spans, message.spans!.map(keysOf)];
});
measure("copies whose fields are read", () => {
  const marks: Mark[] = JSON.parse('[{"at":1,"note":"one"},{"at":2,"note":"three"},{"note":"x","at":3}]');
  return totalOfMovedMarks(marks);
});
