import { List, normalize, useStore } from "./parts";

// The compiler doesn't memoize a function that captures `surface`, because a hook is called while `surface` may still change. It assigns each to a constant.
export function Panel({ store, log }: { store: { names: string[] }; log: (text: string) => void }) {
  const surface = normalize(useStore(store));
  const title = useStore("names");
  const done = ({ chosen }: { chosen: string[] }) => {
    chosen.forEach(name => {
      log(title + ": " + name);
    });
  };
  return (
    <List
      onSelect={index => {
        log("selected " + surface.names[index]);
      }}
      onKey={index => {
        done({ chosen: surface.names.filter((_, at) => at !== index) });
      }}
    >
      {surface.names.map(name => (
        <List.Item label={name + surface.names.length} />
      ))}
    </List>
  );
}
