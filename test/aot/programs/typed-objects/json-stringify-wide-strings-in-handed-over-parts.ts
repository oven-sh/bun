// JSON.stringify of a typed value hands the parts it has no code for (objects made by a spread, untyped data) to the runtime's
// writer. A string there that does not fit in 8 bits is written in place like one in a typed field.
interface Comment {
  id: number;
  body: string;
  at: Date;
}
interface CommentNode extends Comment {
  replies: CommentNode[];
}
interface Thread {
  title: string;
  nodes: CommentNode[];
  extra: unknown;
}

const bodies = [
  "plain",
  "café",
  "arrow → here",
  "\u{1f600}",
  'quote " backslash \\ newline \n tab \t →',
  "\ud800 alone",
  "alone \udc00",
  "  ",
  "",
  "\u0001\u001f\u007f\u0080ÿĀ",
  "→".repeat(70),
  "x".repeat(70) + "→",
  "→".repeat(3000),
];

const comments: Comment[] = bodies.map((body, id) => ({ id, body, at: new Date(1_700_000_000_000 + id * 86_400_123) }));

function nodesOf(from: number, depth: number): CommentNode[] {
  const nodes: CommentNode[] = [];
  for (let i = from; i < comments.length; i += 3) nodes.push({ ...comments[i], replies: depth ? nodesOf(from + 1, depth - 1) : [] });
  return nodes;
}

export function write(thread: Thread): string {
  return JSON.stringify(thread);
}
export function writeNodes(nodes: CommentNode[]): string {
  return JSON.stringify(nodes);
}

function describe(text: string): string {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return text.length + " " + sum + " " + text.slice(0, 60).replace(/[^ -~]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

for (let from = 0; from < 3; from++) {
  for (let depth = 0; depth < 3; depth++) {
    const thread: Thread = { title: from ? "t→" : "t", nodes: nodesOf(from, depth), extra: JSON.parse(JSON.stringify({ list: bodies, ["k" + from]: bodies[from + 2] })) };
    const text = write(thread);
    console.log(from, depth, describe(text), text === JSON.stringify(thread, (key, value) => value), JSON.stringify(JSON.parse(text)) === text);
    console.log(from, depth, describe(writeNodes(thread.nodes)));
  }
}

const wideKey: Thread = { title: "t", nodes: [], extra: JSON.parse('{"\\u2192":"\\u2192","a":1}') };
console.log(describe(write(wideKey)));
const cyclic: Thread = { title: "→", nodes: nodesOf(0, 1), extra: null };
const loop: Record<string, unknown> = { text: "→" };
loop.self = loop;
cyclic.extra = loop;
try {
  write(cyclic);
} catch (error) {
  console.log((error as Error).name);
}
cyclic.extra = { toJSON: () => "→ from toJSON" };
console.log(describe(write(cyclic)));
(globalThis as any).kept = [write, writeNodes];
