// A store with reducers that never change their state: for every action arrays and objects are copied with spread, map and filter, and the listeners are called.
const initial = { todos: [], filter: "all", nextId: 1, stats: { added: 0, done: 0 } };

function todos(state, action) {
  switch (action.type) {
    case "add":
      return [...state, { id: action.id, text: action.text, done: false }];
    case "toggle":
      return state.map(todo => (todo.id === action.id ? { ...todo, done: !todo.done } : todo));
    case "remove":
      return state.filter(todo => todo.id !== action.id);
    default:
      return state;
  }
}

function stats(state, action) {
  switch (action.type) {
    case "add":
      return { ...state, added: state.added + 1 };
    case "toggle":
      return { ...state, done: state.done + 1 };
    default:
      return state;
  }
}

function reducer(state = initial, action) {
  const next = {
    todos: todos(state.todos, action),
    filter: action.type === "filter" ? action.filter : state.filter,
    nextId: action.type === "add" ? state.nextId + 1 : state.nextId,
    stats: stats(state.stats, action),
  };
  return next;
}

function createStore(reduce) {
  let state = reduce(undefined, { type: "@init" });
  const listeners = [];
  return {
    getState: () => state,
    subscribe: listener => listeners.push(listener),
    dispatch(action) {
      state = reduce(state, action);
      for (const listener of listeners) listener(state);
      return action;
    },
  };
}

const visible = ({ todos, filter }) => (filter === "all" ? todos : todos.filter(todo => (filter === "done" ? todo.done : !todo.done)));

function run(rounds) {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const store = createStore(reducer);
    let notified = 0;
    store.subscribe(() => notified++);
    for (let i = 0; i < 40; i++) {
      store.dispatch({ type: "add", id: store.getState().nextId, text: "todo " + i });
      if (i % 3 === 0) store.dispatch({ type: "toggle", id: (i >> 1) + 1 });
      if (i % 7 === 0) store.dispatch({ type: "remove", id: (i >> 2) + 1 });
      if (i % 10 === 0) store.dispatch({ type: "filter", filter: i % 20 === 0 ? "done" : "open" });
    }
    const state = store.getState();
    total += visible(state).length + state.stats.added + state.stats.done + notified;
  }
  return total;
}

console.log(run(4000));
