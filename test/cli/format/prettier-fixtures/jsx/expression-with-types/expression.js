<Component
  onChange={(
    key: "possible_key_1" | "possible_key_2" | "possible_key_3",
    value: string | Immutable.List<string>,
  ) => {
    this.setState({
      updatedTask: this.state.updatedTask.set(key, value)
    });
  }}
/>;

<Component>
  {(
    key: "possible_key_1" | "possible_key_2" | "possible_key_3",
    value: string | Immutable.List<string>,
  ) => {
    this.setState({
      updatedTask: this.state.updatedTask.set(key, value)
    });
  }}
</Component>;
