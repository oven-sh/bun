export type A = B extends { C?: { [D in infer E]?: F } } ? G : H
