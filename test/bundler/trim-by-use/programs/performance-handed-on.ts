function marked(timeline: { mark(name: string): { name: string } }) {
  return timeline.mark("handed on").name;
}
console.log(marked(performance));
