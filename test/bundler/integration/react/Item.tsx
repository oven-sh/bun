export interface ItemProps {
  name: string;
  key: string;
}

export const Item: React.FC<ItemProps> = ({ name, ...props }) => {
  return (
    <div>
      {name ?? "Item"} {JSON.stringify(props)}
    </div>
  );
};
