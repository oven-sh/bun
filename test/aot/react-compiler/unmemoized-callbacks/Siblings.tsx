import { List, useStore } from "./parts";

// prettier-ignore
export const Used = ({ names, log }: { names: string[]; log: (text: string) => void }) => {
    const all = useStore(names);
    return <List onSelect={index => log("used " + all[index])}>{all.map(name => <List.Item label={name} />)}</List>;
  }, Unused = ({ names, log }: { names: string[]; log: (text: string) => void }) => {
    const all = useStore(names);
    return <List onSelect={index => log("unused " + all[index])}>{all.map(name => <List.Item label={name} />)}</List>;
  };
