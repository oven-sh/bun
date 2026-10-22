// A record spread into a wider record type keeps the key order JavaScript gives it, and the compiled JSON.stringify writes it without leaving for the runtime's writer.
// ENV JSC_aotCountsPath=/dev/null
declare const aotOperationCount: undefined | ((name: string) => number);
const slowPathCalls = () =>
  typeof aotOperationCount === "function" ? aotOperationCount("operationAOTJSONAppendElements") : 0;

interface UserRef {
  login: string;
  name: string;
}
interface Comment {
  id: number;
  parentId: number | null;
  author: UserRef;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
}
interface CommentNode extends Comment {
  replies: CommentNode[];
}

function buildThread(comments: Comment[]): CommentNode[] {
  const nodes = new Map<number, CommentNode>();
  const roots: CommentNode[] = [];
  for (const comment of comments) {
    const node: CommentNode = { ...comment, replies: [] };
    nodes.set(node.id, node);
    const parent = comment.parentId === null ? undefined : nodes.get(comment.parentId);
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

const comments: Comment[] = [0, 1, 2, 3, 4, 5].map(at => ({
  id: at + 1,
  parentId: at % 3 ? at : null,
  author: { login: "u" + at, name: "User " + at },
  body: "text " + at,
  createdAt: new Date(1_700_000_000_000 + at * 1000),
  editedAt: at % 2 ? null : new Date(1_700_000_100_000 + at),
}));
let bytes = 0;
for (let round = 0; round < 50; round++) bytes += JSON.stringify({ comments: buildThread(comments) }).length;
console.log(bytes, slowPathCalls() === 0 ? "written by the compiled writer" : "left the compiled writer");
console.log(JSON.stringify(buildThread(comments)));
console.log(Object.keys(buildThread(comments)[0]!).join());

const again: CommentNode = { ...buildThread(comments)[0]!, replies: [] };
console.log(Object.keys(again).join(), JSON.stringify(again));

interface Point {
  x: number;
  y?: number;
}
interface Labeled extends Point {
  label: string;
  weight?: number;
}
const label = (point: Point, text: string): Labeled => ({ ...point, label: text });
const weigh = (point: Point, text: string, weight: number): Labeled => ({ ...point, label: text, weight });
const points: Point[] = [{ x: 1 }, { x: 2, y: 3 }, { y: 4, x: 5 }];
for (const point of points) {
  console.log(JSON.stringify(label(point, "a")), Object.keys(label(point, "a")).join());
  console.log(JSON.stringify(weigh(point, "b", 2)), Object.keys(weigh(point, "b", 2)).join());
  console.log(JSON.stringify([label(point, "c"), weigh(point, "d", 3)]));
}

interface Versioned extends Comment {
  version: number;
}
const bump = (comment: Comment): Versioned => ({ ...comment, id: comment.id + 100, version: 2 });
console.log(JSON.stringify(comments.map(bump).slice(0, 2)), Object.keys(bump(comments[0]!)).join());
