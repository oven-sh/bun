const foo = call<{
  prop1: string;
  prop2: string;
  prop3: string;
}>();

export const CallRecorderContext =
  createContext<{
    deleteRecording: (id: string) => void;
    deleteAll: () => void;
  } | null>(null);

export const CallRecorderContext =
  createContext<{
    deleteRecording: (id: string) => void;
    deleteAll: () => void;
  } | null>(null, "useless");

const foo =
  call<Foooooo, Foooooo, Foooooo, Foooooo, Foooooo, Foooooo, Foooooo>();

const foo =
  call<
    | Foooooooooooo
    | Foooooooooooo
    | Foooooooooooo
    | Foooooooooooo
    | Foooooooooooo
  >();

const foo =
  call<
    Foooooooooooo &
      Foooooooooooo &
      Foooooooooooo &
      Foooooooooooo &
      Foooooooooooo
  >();
