tt.parenR.updateContext = tt.braceR.updateContext = function () {
  if (this.state.context.length === 1) {
    return;
  }
}
