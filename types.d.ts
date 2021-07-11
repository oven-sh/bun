interface SpeedyNodeModule extends NodeJS.Module {
  requireFirst(...id: string[]): any;
}

declare var module: SpeedyNodeModule;
