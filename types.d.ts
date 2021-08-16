interface BunNodeModule extends NodeJS.Module {
  requireFirst(...id: string[]): any;
}

declare var module: BunNodeModule;
