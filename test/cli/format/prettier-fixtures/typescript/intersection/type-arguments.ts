// #6988

// functional component with ugly linebreak
export const MyLongNamedReactFunctionalComponent1: FunctionComponent<ALongNamedInterface1 & ALongNamedInterface2> = (props) => {}

// functional component with valid linebreak
export const MyLongNamedReactFunctionalComponent2: FunctionComponent<ALongNamedInterface1 | ALongNamedInterface2> = (props) => {}

// functional component with valid linebreak
export const MyLongNamedReactFunctionalComponent3: FunctionComponent<ALongNamedInterface1, ALongNamedInterface2> = (props) => {}
