class Timer {
  ticks = 0;
  tick(): number {
    return ++this.ticks;
  }
  reset(): void {
    this.ticks = 0;
  }
}

class Metronome {
  tempo = 3;
  history: number[] = [];
  ticks = 0;
  tick(): number {
    this.ticks += this.tempo;
    this.history.push(this.ticks);
    return this.ticks;
  }
  reset(): void {
    this.history.length = 0;
    this.tempo++;
    this.ticks = -1;
  }
}

function run(t: Timer, times: number): number {
  let last = 0;
  for (let i = 0; i < times; i++) last = t.tick();
  return last;
}

function restart(t: Timer): number {
  t.reset();
  return t.tick();
}

const timer = new Timer();
const metronome = new Metronome();

console.log("timer: " + run(timer, 3) + " " + JSON.stringify(timer));
console.log("metronome through the timer's type: " + run(metronome, 3) + " " + JSON.stringify(metronome));
console.log("timer restarted: " + restart(timer) + " " + JSON.stringify(timer));
console.log("metronome restarted: " + restart(metronome) + " " + JSON.stringify(metronome));

console.log("the timer's method on the metronome: " + Timer.prototype.tick.call(metronome) + " " + JSON.stringify(metronome));
const asTimer: Timer = metronome;
const borrowed = asTimer.tick;
console.log("the metronome's method on a fresh metronome: " + borrowed.call(new Metronome()));

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

attempt("the metronome's method on a timer", () => borrowed.call(new Timer()));
attempt("the metronome's reset on a timer", () => asTimer.reset.call(new Timer()));
attempt("a method without its object", () => {
  const free = asTimer.tick;
  return free();
});
attempt("a method handed to a built-in", () => [1, 2].map(asTimer.tick).join());
attempt("a method handed to a built-in with its object", () => [1, 2].map(asTimer.tick, new Metronome()).join());
attempt("bound to the look-alike", () => timer.tick.bind(metronome)());
attempt("bound to the timer", () => asTimer.tick.bind(timer)());

run(new Timer(), 2000);
console.log("after 2000 honest ticks: " + run(new Metronome(), 2) + " " + run(new Timer(), 2));

class Stage {
  clocks: Timer[] = [new Timer(), new Metronome(), new Timer()];
  main: Timer = new Metronome();
  beat(): string {
    return this.clocks.map(c => c.tick()).join() + " " + this.main.tick();
  }
}

const stage = new Stage();
console.log("fields and elements: " + stage.beat() + " | " + stage.beat());
console.log("what they hold: " + JSON.stringify(stage));

export {};
