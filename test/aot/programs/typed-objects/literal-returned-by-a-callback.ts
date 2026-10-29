// `rows.map(row => ({ .. }))` where Comment[] is expected: the literal, and the literal nested in it, are born as Comment and UserRef, not as anonymous layouts of their own. So a later `{ ...comment, replies: [] }` copies within one family of layouts.
// IR+ ^layout (L\d+) .*name="Comment" [\s\S]*: =?\1 = NewObject 
interface Row { id: number; parentId: number | null; authorLogin: string; authorName: string; body: string }
interface UserRef { login: string; name: string }
interface Comment { id: number; parentId: number | null; author: UserRef; body: string }
interface CommentNode extends Comment { replies: CommentNode[] }

function commentsOf(rows: readonly Row[]): Comment[] {
  return rows.map(row => ({ id: row.id, parentId: row.parentId, author: { login: row.authorLogin, name: row.authorName }, body: row.body }));
}
function withBlockBody(rows: readonly Row[]): Comment[] {
  return rows.map(row => {
    const author: UserRef = { login: row.authorLogin, name: row.authorName };
    return { id: row.id, parentId: row.parentId, author, body: row.body };
  });
}
function withOneMore(rows: readonly Row[]): Comment[] {
  return rows.map(row => ({ id: row.id, parentId: row.parentId, author: { login: row.authorLogin, name: row.authorName }, body: row.body, more: 1 }));
}
function firstOf(rows: readonly Row[]): UserRef[] {
  const found: UserRef[] = rows.filter(row => row.id < 2).map(row => ({ login: row.authorLogin, name: row.authorName }));
  return found;
}
async function later(rows: readonly Row[]): Promise<Comment[]> {
  return Promise.all(rows.map(async row => ({ id: row.id, parentId: row.parentId, author: { login: row.authorLogin, name: row.authorName }, body: row.body })));
}
function buildThread(comments: readonly Comment[]): CommentNode[] {
  const nodes: CommentNode[] = [];
  for (const comment of comments) nodes.push({ ...comment, replies: [] });
  return nodes;
}
function describe(nodes: readonly CommentNode[]): string {
  let text = "";
  for (const node of nodes) text += node.id + ":" + node.parentId + ":" + node.author.login + ":" + node.author.name + ":" + node.body + ":" + node.replies.length + ":" + Object.keys(node).join("+") + " ";
  return text;
}

const rows: Row[] = [];
for (let i = 0; i < 3; i++) rows.push({ id: i, parentId: i ? i - 1 : null, authorLogin: "l" + i, authorName: "n" + i, body: "b" + i });
const makers: ((rows: readonly Row[]) => Comment[])[] = [commentsOf, withBlockBody, withOneMore];
for (const make of makers) {
  const made = make(rows);
  console.log(JSON.stringify(made));
  console.log(describe(buildThread(made)));
  made[0]!.author.name = "changed";
  made[0]!.body = "changed too";
  console.log(made[0]!.author.name, JSON.stringify(made[0]), Object.keys(made[0]!).join());
}
console.log(JSON.stringify(firstOf(rows)));
later(rows).then(made => console.log(describe(buildThread(made))));
