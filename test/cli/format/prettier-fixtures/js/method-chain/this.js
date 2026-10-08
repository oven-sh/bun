const sel = this.connections
  .concat(this.activities.concat(this.operators))
  .filter(x => x.selected);
