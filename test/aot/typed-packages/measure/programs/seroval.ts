import { fromJSON, serialize, toJSON } from "seroval";
import { run } from "../turns";

interface Comment {
  id: number;
  author: { id: number; name: string };
  postedAt: Date;
  text: string;
  likedBy: Set<number>;
  replies: Comment[];
}

function makeComment(id: number, depth: number): Comment {
  return {
    id,
    author: { id: id % 13, name: `user-${id % 13}` },
    postedAt: new Date(1760000000000 + id * 86400000),
    text: `Comment ${id}: "quoted" <b>text</b> & more\nsecond line`,
    likedBy: new Set([id % 5, id % 7, id % 11]),
    replies: depth > 0 ? [makeComment(id * 3 + 1, depth - 1), makeComment(id * 3 + 2, depth - 1)] : [],
  };
}

const shared = { theme: "dark", flags: ["a", "b", "c"] };
const loaderData = {
  user: { id: 1, name: "Zoë", settings: shared, lastSeen: new Date(1760000000000), balance: 12345678901234567890n },
  settings: shared,
  comments: Array.from({ length: 20 }, (_, index) => makeComment(index, 3)),
  counts: new Map<string, number>(Array.from({ length: 50 }, (_, index) => [`key-${index}`, index * index])),
  pattern: /ab+c/gi,
  missing: undefined,
  sparse: [1, , 3],
  ratio: -0,
  limit: Infinity,
};

const how = process.argv[2];

await run(() => (how === "json" ? JSON.stringify(toJSON(fromJSON(toJSON(loaderData)))) : serialize(loaderData)));
