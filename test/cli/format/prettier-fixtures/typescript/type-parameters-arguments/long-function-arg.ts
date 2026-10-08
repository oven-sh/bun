export const forwardS = R.curry(
  <V,T>(prop: string, reducer: ReducerFunction<V, T>, value: V, state: {[name: string]: T}) =>
  R.assoc(prop, reducer(value, state[prop]), state)
)

export const forwardS1 = R.curry(
  <VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV, TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT>(prop: string, reducer: ReducerFunction<V, T>, value: V, state: {[name: string]: T}) =>
  R.assoc(prop, reducer(value, state[prop]), state)
)

