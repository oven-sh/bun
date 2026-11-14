import { App, controls, store, type Block, type Message, type Task } from "./app";
import { counts, mount, options } from "./host";

let seed = 12345;
function next(below: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed % below;
}

const words = ["alpha", "beta", "`code`", "gamma", "delta", "render", "scope", "cache", "slot", "`memo`", "fiber", "tree", "commit", "lane"];
const sentence = (length: number) => Array.from({ length }, () => words[next(words.length)]).join(" ");

let nextMessage = 1;
function makeMessage(role: Message["role"], text: string): Message {
  const blocks: Block[] = [{ kind: "text", text }];
  if (role === "assistant") {
    if (next(2)) blocks.push({ kind: "code", language: "ts", lines: Array.from({ length: 4 }, () => sentence(5)) });
    blocks.push({ kind: "tool", name: "Run", input: { command: "ls", cwd: "." }, status: next(5) ? "ok" : "error", output: Array.from({ length: 5 }, () => sentence(4)) });
  }
  return { id: nextMessage++, role, blocks, words: 10 + next(200), at: 36000 + nextMessage * 7 };
}

function makeTasks(): Record<string, Task> {
  const tasks: Record<string, Task> = {};
  for (let index = 0; index < 9; index++) {
    const id = "task-" + index;
    tasks[id] = { id, title: sentence(3), status: index % 4 === 3 ? "done" : "running", parent: index < 3 ? null : "task-" + (index % 3), startedAt: 36000 - index };
  }
  return tasks;
}

export function start(numberOfMessages: number, paints: boolean) {
  options.paints = paints;
  store.setState(state => ({
    ...state,
    messages: Array.from({ length: numberOfMessages }, (_, index) => makeMessage(index % 2 ? "assistant" : "user", sentence(14))),
    tasks: makeTasks(),
  }));
  const { screen, settle } = mount(<App />, store.getState().settings.columns);
  let turns = 0;

  return {
    counts,
    turn(): string {
      turns++;
      store.setState(state => ({ ...state, frame: state.frame + 1 }));
      settle();
      store.setState(state => ({ ...state, draft: state.draft + (state.draft === "" ? "" : turns % 24 === 0 ? "\n\n" : " ") + words[next(words.length)], words: { ...state.words, written: state.words.written + 1 } }));
      settle();
      controls.current!.type(turns % 16 === 1 ? "/" : "cdefhiorsu"[next(10)]);
      settle();
      if (turns % 4 === 0) {
        store.setState(state => ({ ...state, now: state.now + 1 }));
        settle();
      }
      if (turns % 16 === 0) {
        controls.current!.submit();
        settle();
      }
      if (turns % 48 === 0) {
        store.setState(state => ({
          ...state,
          messages: [...state.messages.slice(2), makeMessage("user", sentence(8)), makeMessage("assistant", state.draft)],
          draft: "",
          words: { read: state.words.read + 40, written: state.words.written },
          selected: state.messages[4].id,
        }));
        settle();
      }
      if (turns % 96 === 0) {
        const id = "task-" + next(9);
        store.setState(state => ({ ...state, tasks: { ...state.tasks, [id]: { ...state.tasks[id], status: state.tasks[id].status === "running" ? "done" : "running" } } }));
        settle();
      }
      if (turns % 480 === 0) {
        store.setState(state => ({ ...state, settings: { ...state.settings, verbose: !state.settings.verbose } }));
        settle();
      }
      return paints ? screen.written : JSON.stringify(counts);
    },
    frame() {
      screen.paint();
      return screen.frame.join("\n");
    },
  };
}
