import { useSyncExternalStore } from "react";

export type Listener = () => void;

export interface Store<State> {
  getState(): State;
  setState(update: (before: State) => State): void;
  subscribe(listener: Listener): () => void;
}

export function createStore<State>(initial: State): Store<State> {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: () => state,
    setState(update) {
      const next = update(state);
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export function useStore<State, Selected>(store: Store<State>, select: (state: State) => Selected): Selected {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
