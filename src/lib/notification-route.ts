const allowedRoutes = new Set(['/team', '/hub', '/coordination', '/milestones', '/import', '/board-setup', '/files', '/notifications', '/knowledge', '/scorer', '/admin', '/profile']);

/** Accept only internal, known routes so notification data cannot redirect outside the app. */
export function safeInternalRoute(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/coordination';
  try {
    const url = new URL(value, 'https://first-pit.invalid');
    const pathname = url.pathname === '/tracker' || url.pathname === '/calendar' ? '/coordination' : url.pathname;
    if (!allowedRoutes.has(pathname)) return '/coordination';
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return '/coordination';
  }
}
