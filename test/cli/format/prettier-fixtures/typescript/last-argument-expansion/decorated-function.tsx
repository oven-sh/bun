const Counter = decorator("my-counter")(
  (props: { initialCount?: number; label?: string }) => {
    const p = useDefault(props, {
      initialCount: 0,
      label: "Counter",
    });

    const [s, set] = useState({ count: p.initialCount });
    const onClick = () => set("count", (it) => it + 1);

    return () => (
      <button onclick={onClick}>
        {p.label}: {s.count}
      </button>
    );
  }
);

const Counter2 = decorators.decorator("my-counter")(
  (props: { initialCount?: number; label?: string }) => {
    return () => (
      <button onclick={onClick}>
        {p.label}: {s.count}
      </button>
    );
  }
);

export default decorators.decorator("my-counter")(
  (props: { initialCount?: number; label?: string }) => {
    return foo;
  }
);

export = decorators.decorator("my-counter")(
  (props: { initialCount?: number; label?: string }) => {
    return foo;
  }
);

module.exports = decorators.decorator("my-counter")(
  (props: { initialCount?: number; label?: string }) => {
    return foo;
  }
);

const Counter =
  decorator("foo")(
  decorator("bar")(
  (props: {
    loremFoo1: Array<Promise<any>>,
    ipsumBarr2: Promise<number>,
  }) => {
    return <div/>;
  }));
