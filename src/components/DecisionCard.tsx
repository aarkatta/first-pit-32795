type DecisionCardProps = {
  title: string;
  body: string;
};

export function DecisionCard({ title, body }: DecisionCardProps) {
  return (
    <article className="card">
      <p className="eyebrow">Confirmed</p>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}
