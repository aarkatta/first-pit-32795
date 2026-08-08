import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="card">
      <p className="eyebrow">Not found</p>
      <h1>This route is not part of the Phase 0 shell.</h1>
      <p>The app will add feature routes in later phases as the foundation gets filled in.</p>
      <Link className="button" to="/">
        Back to overview
      </Link>
    </section>
  );
}
