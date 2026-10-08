type Mapped = {
  [key in keyof O]: number;
  extra_member: should_not_allowed
};
