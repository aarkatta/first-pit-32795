import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="team-hero">
      <div><span className="eyebrow light">404 · NOT FOUND</span><h3>This route is not part of the Phase 1 foundation.</h3><p>The route does not exist or is no longer available in this team workspace.</p></div>
      <Link className="button" to="/">Back to overview</Link>
    </section>
  );
}
