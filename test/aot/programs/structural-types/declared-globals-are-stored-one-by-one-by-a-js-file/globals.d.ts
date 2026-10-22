declare const appVersion: number;
declare let appName: string;
declare function appStart(port: number): number;
declare const appMissing: number;
declare namespace App {
  const retries: number;
  function stop(): boolean;
}
interface AppOptions {
  depth: number;
}
declare const appOptions: AppOptions;
