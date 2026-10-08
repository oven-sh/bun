type BufferStreamOrVoid<
  C extends undefined | Buffer | Stream | boolean,
  P extends undefined | Buffer,
  R extends Buffer | Stream | void = // Inline comment about void.
  // Above line comment about exclue.
  Exclude<C, false> extends never
    ? void
    : C & P extends Buffer
    ? Buffer
    : Stream
> = R;

type A<
  B  = // Inline comment about void.
  // Above line comment about exclue.
  C
> = R;
