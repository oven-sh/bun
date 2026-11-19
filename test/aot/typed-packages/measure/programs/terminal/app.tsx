import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { c as memoCache } from "react/compiler-runtime";
import type { Styles, TextStyles } from "./host";
import { createStore, useStore } from "./store";

declare module "react/compiler-runtime" {
  export function c(size: number): any[];
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "terminal-box": { children?: ReactNode; style?: Styles };
      "terminal-text": { children?: ReactNode; style?: Styles; textStyles?: TextStyles };
    }
  }
}

export type Block =
  | { kind: "text"; text: string }
  | { kind: "code"; language: string; lines: string[] }
  | { kind: "tool"; name: string; input: Record<string, string>; status: "running" | "ok" | "error"; output: string[] };

export interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  blocks: Block[];
  words: number;
  at: number;
}

export interface Task {
  id: string;
  title: string;
  status: "running" | "done" | "failed";
  parent: string | null;
  startedAt: number;
}

export interface Settings {
  verbose: boolean;
  theme: "dark" | "light";
  plan: string;
  level: "low" | "medium" | "high";
  columns: number;
}

export interface AppState {
  messages: Message[];
  draft: string;
  frame: number;
  now: number;
  tasks: Record<string, Task>;
  settings: Settings;
  words: { read: number; written: number };
  selected: number | null;
  notices: string[];
}

export const store = createStore<AppState>({
  messages: [],
  draft: "",
  frame: 0,
  now: 36000,
  tasks: {},
  settings: { verbose: false, theme: "dark", plan: "extended", level: "medium", columns: 100 },
  words: { read: 0, written: 0 },
  selected: null,
  notices: [],
});

interface Theme {
  accent: string;
  muted: string;
  error: string;
  ok: string;
  user: string;
  code: string;
  border: string;
}

const themes: Record<Settings["theme"], Theme> = {
  dark: { accent: "213", muted: "245", error: "196", ok: "40", user: "39", code: "222", border: "240" },
  light: { accent: "90", muted: "240", error: "160", ok: "28", user: "25", code: "94", border: "250" },
};
const ThemeContext = createContext<Theme>(themes.dark);
const WidthContext = createContext(100);

function Box(props: Styles & { children?: ReactNode }) {
  const { children, ...style } = props;
  return <terminal-box style={style}>{children}</terminal-box>;
}

function Text(props: TextStyles & { children?: ReactNode }) {
  const $ = memoCache(11);
  const { children, color, background, bold, dim, italic, underline, inverse } = props;
  let textStyles: TextStyles;
  if ($[0] !== color || $[1] !== background || $[2] !== bold || $[3] !== dim || $[4] !== italic || $[5] !== underline || $[6] !== inverse) {
    textStyles = { color, background, bold, dim, italic, underline, inverse };
    $[0] = color;
    $[1] = background;
    $[2] = bold;
    $[3] = dim;
    $[4] = italic;
    $[5] = underline;
    $[6] = inverse;
    $[7] = textStyles;
  } else textStyles = $[7];
  let element: ReactNode;
  if ($[8] !== children || $[9] !== textStyles) {
    element = <terminal-text textStyles={textStyles}>{children}</terminal-text>;
    $[8] = children;
    $[9] = textStyles;
    $[10] = element;
  } else element = $[10];
  return element;
}

function Frame(props: Styles & { children?: ReactNode; tone?: keyof Theme }) {
  const theme = useContext(ThemeContext);
  const { tone, children, ...rest } = props;
  return (
    <Box {...rest} borderColor={tone ? theme[tone] : theme.border}>
      {children}
    </Box>
  );
}

function Muted({ children }: { children?: ReactNode }) {
  const theme = useContext(ThemeContext);
  return (
    <Text color={theme.muted} dim>
      {children}
    </Text>
  );
}

function Accent({ children, bold }: { children?: ReactNode; bold?: boolean }) {
  const theme = useContext(ThemeContext);
  return (
    <Text color={theme.accent} bold={bold}>
      {children}
    </Text>
  );
}

function Badge({ label, tone }: { label: string; tone: keyof Theme }) {
  const $ = memoCache(3);
  const theme = useContext(ThemeContext);
  const color = theme[tone];
  let element: ReactNode;
  if ($[0] !== color || $[1] !== label) {
    element = (
      <Text color={color} bold>
        [{label}]
      </Text>
    );
    $[0] = color;
    $[1] = label;
    $[2] = element;
  } else element = $[2];
  return element;
}

const two = (value: number) => (value < 10 ? "0" + value : "" + value);
const clock = (at: number) => `${two(Math.floor(at / 3600) % 24)}:${two(Math.floor(at / 60) % 60)}:${two(at % 60)}`;

interface Plan {
  id: string;
  aliases: string[];
  levels: Settings["level"][];
  quota: number;
}

const plans: Plan[] = [
  { id: "basic", aliases: ["free", "b"], levels: ["low"], quota: 100_000 },
  { id: "standard", aliases: ["default", "s"], levels: ["low", "medium"], quota: 200_000 },
  { id: "extended", aliases: ["more", "e"], levels: ["low", "medium", "high"], quota: 200_000 },
  { id: "unlimited", aliases: ["all"], levels: ["low", "medium", "high"], quota: 1_000_000 },
];

const normalize = (name: string) => name.trim().toLowerCase().replace(/\s+plan$/, "");

function planOf(name: string): Plan | undefined {
  const wanted = normalize(name);
  return plans.find(plan => plan.id === wanted || plan.aliases.some(alias => alias === wanted));
}

function levelIn(settings: Settings): Settings["level"] {
  const plan = planOf(settings.plan);
  if (!plan) return "low";
  return plan.levels.includes(settings.level) ? settings.level : plan.levels[plan.levels.length - 1];
}

function Header() {
  const plan = useStore(store, state => state.settings.plan);
  const width = useContext(WidthContext);
  return (
    <Frame flexDirection="column" borderStyle="round" paddingX={1} width={width}>
      <Box gap={1}>
        <Accent bold>{"<*>"}</Accent>
        <Text bold>terminal</Text>
        <Badge label={plan} tone="accent" />
        <Muted>~/work/project</Muted>
      </Box>
    </Frame>
  );
}

function InlineCode({ code }: { code: string }) {
  const theme = useContext(ThemeContext);
  return <Text color={theme.code}>{code}</Text>;
}

function Paragraph({ text }: { text: string }) {
  const $ = memoCache(2);
  let element: ReactNode;
  if ($[0] !== text) {
    element = <Text>{text.split("`").map((part, index) => (index % 2 === 1 ? <InlineCode key={index} code={part} /> : part))}</Text>;
    $[0] = text;
    $[1] = element;
  } else element = $[1];
  return element;
}

function CodeBlock({ language, lines }: { language: string; lines: string[] }) {
  const theme = useContext(ThemeContext);
  return (
    <Frame flexDirection="column" borderStyle="single" paddingX={1}>
      <Muted>{language}</Muted>
      {lines.map((line, index) => (
        <Box key={index} gap={1}>
          <Muted>{two(index + 1)}</Muted>
          <Text color={theme.code}>{line}</Text>
        </Box>
      ))}
    </Frame>
  );
}

function ToolBlock({ block, verbose }: { block: Extract<Block, { kind: "tool" }>; verbose: boolean }) {
  const shown = verbose ? block.output : block.output.slice(0, 2);
  const hidden = block.output.length - shown.length;
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box gap={1}>
        <Badge label={block.status} tone={block.status === "error" ? "error" : block.status === "ok" ? "ok" : "accent"} />
        <Text bold>{block.name}</Text>
        <Muted>
          {Object.entries(block.input)
            .map(([name, value]) => `${name}=${value}`)
            .join(" ")}
        </Muted>
      </Box>
      {shown.map((line, index) => (
        <Muted key={index}>{line}</Muted>
      ))}
      {hidden > 0 ? <Muted>{`.. ${hidden} more lines`}</Muted> : null}
    </Box>
  );
}

function BlockView({ block, verbose }: { block: Block; verbose: boolean }) {
  switch (block.kind) {
    case "text":
      return <Paragraph text={block.text} />;
    case "code":
      return <CodeBlock language={block.language} lines={block.lines} />;
    case "tool":
      return <ToolBlock block={block} verbose={verbose} />;
  }
}

const MessageRow = memo(function MessageRow({ message }: { message: Message }) {
  const theme = useContext(ThemeContext);
  const isSelected = useStore(store, state => state.selected === message.id);
  const verbose = useStore(store, state => state.settings.verbose);
  const color = message.role === "user" ? theme.user : message.role === "system" ? theme.muted : theme.accent;
  return (
    <Box flexDirection="row" gap={1} marginBottom={1}>
      <Text color={color} inverse={isSelected}>
        {message.role === "user" ? ">" : message.role === "system" ? "#" : "*"}
      </Text>
      <Box flexDirection="column" flexGrow={1}>
        {message.blocks.map((block, index) => (
          <BlockView key={index} block={block} verbose={verbose} />
        ))}
        {verbose ? <Muted>{`${clock(message.at)} ${message.words} words`}</Muted> : null}
      </Box>
    </Box>
  );
});

function Transcript() {
  const messages = useStore(store, state => state.messages);
  return (
    <Box flexDirection="column">
      {messages.map(message => (
        <MessageRow key={message.id} message={message} />
      ))}
    </Box>
  );
}

function Draft() {
  const text = useStore(store, state => state.draft);
  const paragraphs = useMemo(() => text.split("\n\n"), [text]);
  if (text === "") return null;
  return (
    <Box flexDirection="row" gap={1} marginBottom={1}>
      <Accent>*</Accent>
      <Box flexDirection="column" flexGrow={1}>
        {paragraphs.map((paragraph, index) => (
          <Paragraph key={index} text={paragraph} />
        ))}
      </Box>
    </Box>
  );
}

function descendantsOf(tasks: Record<string, Task>, id: string): number {
  let count = 0;
  for (const task of Object.values(tasks)) if (task.parent === id) count += 1 + descendantsOf(tasks, task.id);
  return count;
}

function TaskLine({ task, children: below, now }: { task: Task; children: number; now: number }) {
  const tone = task.status === "failed" ? "error" : task.status === "done" ? "ok" : "accent";
  return (
    <Box gap={1}>
      <Badge label={task.status} tone={tone} />
      <Text>{task.title}</Text>
      {below > 0 ? <Muted>{`+${below}`}</Muted> : null}
      {task.status === "running" ? <Muted>{`${now - task.startedAt}s`}</Muted> : null}
    </Box>
  );
}

function Tasks() {
  const tasks = useStore(store, state => state.tasks);
  const now = useStore(store, state => state.now);
  const top = useMemo(() => Object.values(tasks).filter(task => task.parent === null), [tasks]);
  const running = Object.values(tasks).filter(task => task.status === "running").length;
  if (top.length === 0) return null;
  return (
    <Frame flexDirection="column" borderStyle="single" paddingX={1}>
      <Muted>{`${running} of ${Object.keys(tasks).length} running`}</Muted>
      {top.map(task => (
        <TaskLine key={task.id} task={task} now={now}>
          {descendantsOf(tasks, task.id)}
        </TaskLine>
      ))}
    </Frame>
  );
}

const glyphs = ["|", "/", "-", "\\"];
const verbs = ["Sorting", "Reading", "Writing", "Checking"];

function useElapsed(since: number) {
  const now = useStore(store, state => state.now);
  return now - since;
}

function useNarrowness() {
  const width = useContext(WidthContext);
  const seen = useRef({ width, changes: 0 });
  const isNarrow = useCallback(() => seen.current.width < 60, []);
  useLayoutEffect(() => {
    if (seen.current.width !== width) seen.current = { width, changes: seen.current.changes + 1 };
  }, [width]);
  return { width, isNarrow };
}

function Progress() {
  const frame = useStore(store, state => state.frame);
  const written = useStore(store, state => state.words.written);
  const elapsed = useElapsed(36000);
  const narrowness = useNarrowness();
  const painted = useRef(0);
  useEffect(() => {
    painted.current++;
  }, [frame]);
  const verb = verbs[Math.floor(frame / 40) % verbs.length];
  return (
    <Box gap={1}>
      <Accent>{glyphs[frame % glyphs.length]}</Accent>
      <Accent bold>{verb + ".."}</Accent>
      {narrowness.isNarrow() ? null : <Muted>{`(${elapsed}s . ${written} words . esc to stop)`}</Muted>}
    </Box>
  );
}

const commands = ["/close", "/copy", "/count", "/delete", "/edit", "/export", "/find", "/help", "/history", "/insert", "/open", "/redo", "/rename", "/save", "/sort", "/undo"];

type History = { entries: string[]; at: number };
type HistoryAction = { kind: "push"; text: string } | { kind: "older" } | { kind: "newer" };

function historyReducer(history: History, action: HistoryAction): History {
  switch (action.kind) {
    case "push":
      return { entries: [...history.entries.slice(-19), action.text], at: -1 };
    case "older":
      return { ...history, at: Math.min(history.entries.length - 1, history.at + 1) };
    case "newer":
      return { ...history, at: Math.max(-1, history.at - 1) };
  }
}

export interface Controls {
  type(text: string): void;
  submit(): void;
}

export const controls: { current: Controls | null } = { current: null };

function Suggestions({ matches, selected }: { matches: string[]; selected: number }) {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {matches.map((match, index) => (
        <Text key={match} inverse={index === selected}>
          {match}
        </Text>
      ))}
    </Box>
  );
}

function Editor() {
  const [input, setInput] = useState("");
  const [history, dispatch] = useReducer(historyReducer, { entries: [], at: -1 });
  const settings = useStore(store, state => state.settings);
  const level = levelIn(settings);
  const latest = useRef(input);
  latest.current = input;
  const type = useCallback((text: string) => setInput(before => before + text), []);
  const submit = useCallback(() => {
    dispatch({ kind: "push", text: latest.current });
    setInput("");
  }, []);
  useEffect(() => {
    controls.current = { type, submit };
    return () => {
      controls.current = null;
    };
  }, [type, submit]);
  const matches = useMemo(() => (input.startsWith("/") ? commands.filter(command => command.startsWith(input)) : []), [input]);
  return (
    <Box flexDirection="column">
      <Frame borderStyle="round" paddingX={1} gap={1} tone={input.startsWith("/") ? "accent" : "border"}>
        <Accent bold>{">"}</Accent>
        <Text>{input}</Text>
        <Text inverse> </Text>
      </Frame>
      {matches.length > 0 ? <Suggestions matches={matches} selected={0} /> : null}
      <Box justifyContent="between">
        <Muted>{`${history.entries.length} in history`}</Muted>
        <Muted>{`level ${level}`}</Muted>
      </Box>
    </Box>
  );
}

function KeyHint({ keys, what }: { keys: string; what: string }) {
  const $ = memoCache(3);
  let element: ReactNode;
  if ($[0] !== keys || $[1] !== what) {
    element = (
      <Box gap={1}>
        <Accent bold>{keys}</Accent>
        <Muted>{what}</Muted>
      </Box>
    );
    $[0] = keys;
    $[1] = what;
    $[2] = element;
  } else element = $[2];
  return element;
}

function Footer() {
  const words = useStore(store, state => state.words);
  const plan = useStore(store, state => state.settings.plan);
  const quota = planOf(plan)?.quota ?? 100_000;
  const used = words.read + words.written;
  const price = (words.read * 3 + words.written * 15) / 1e6;
  return (
    <Box justifyContent="between">
      <Box gap={2}>
        <KeyHint keys="?" what="shortcuts" />
        <KeyHint keys="ctrl-d" what="details" />
      </Box>
      <Box gap={1}>
        <Muted>{`${used} words`}</Muted>
        <Muted>{`${Math.round((100 * used) / quota)}% of the quota`}</Muted>
        <Muted>{`$${price.toFixed(4)}`}</Muted>
      </Box>
    </Box>
  );
}

function Notices() {
  const notices = useStore(store, state => state.notices);
  if (notices.length === 0) return null;
  return (
    <Box flexDirection="column">
      {notices.map(notice => (
        <Text key={notice} color="214">
          {notice}
        </Text>
      ))}
    </Box>
  );
}

export function App() {
  const theme = useStore(store, state => state.settings.theme);
  const columns = useStore(store, state => state.settings.columns);
  return (
    <ThemeContext.Provider value={themes[theme]}>
      <WidthContext.Provider value={columns}>
        <Box flexDirection="column" width={columns}>
          <Header />
          <Transcript />
          <Draft />
          <Tasks />
          <Progress />
          <Notices />
          <Editor />
          <Footer />
        </Box>
      </WidthContext.Provider>
    </ThemeContext.Provider>
  );
}
