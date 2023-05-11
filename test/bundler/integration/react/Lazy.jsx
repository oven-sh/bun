export default function Lazy({ prop }) {
  return (
    <div>
      <p className="lazy">Lazy loaded chunk: {import.meta.url}</p>
      <code>{JSON.stringify(prop)}</code>
    </div>
  );
}
