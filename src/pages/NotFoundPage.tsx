import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="team-hero">
      <div><span className="eyebrow light">404 · NOT FOUND</span><h3>We could not find that page.</h3><p>The link may be out of date, or the page is no longer available in this team workspace.</p></div>
      <Link className="button" to="/">Back to overview</Link>
    </section>
  );
}
