export const Foo = forwardRef((props: FooProps, ref: Ref<HTMLElement>): JSX.Element => {
  return <div />;
});

export const Bar = forwardRef((props: BarProps, ref: Ref<HTMLElement>): JSX.Element | null => {
  return <div />;
});

users.map((user: User): User => {
  return user;
})

users.map((user: User): User => {
  ; // comment
})

users.map((user: User): User => {
  // comment
})
