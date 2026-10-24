export function Tagged(Base) {
  return class extends Base {
    tag = "tagged in javascript";
    constructor(...args) {
      super(...args);
      this.late = "stored in javascript";
    }
  };
}
