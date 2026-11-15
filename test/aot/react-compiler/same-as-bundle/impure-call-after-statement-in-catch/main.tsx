// --minify-syntax merges the two statements of the catch into one. The compiler then no longer gives nextId() a cache slot of its own.
import { useMemo } from "react";
import { render } from "../react-stand-in/render";

const notes: string[] = [];
let lastId = 0;
function nextId(): number {
  return ++lastId;
}
function note(text: string): void {
  notes.push(text);
}
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Params = { message: string; schema: object };

function Dialog({ params }: { params: Params }): string {
  const key = useMemo(() => {
    try {
      return "form " + params.message + JSON.stringify(params.schema);
    } catch (error) {
      note(`not JSON: ${describe(error)}`);
      return `form ${nextId()}`;
    }
  }, [params]);
  return key;
}

function unreadable(message: string): Params {
  const schema = {};
  Object.defineProperty(schema, "toJSON", {
    value() {
      throw new Error("unreadable");
    },
  });
  return { message, schema };
}

for (const message of ["a", "b", "c", "d"]) console.log(render(Dialog, { params: unreadable(message) }));
console.log(notes.length);
