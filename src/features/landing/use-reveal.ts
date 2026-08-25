import { useEffect, type RefObject } from 'react';

/**
 * Marks every `[data-reveal]` descendant with `data-shown="true"` the first
 * time it scrolls into view. Falls back to showing everything immediately when
 * IntersectionObserver is unavailable (jsdom, very old web views).
 */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const targets = Array.from(node.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((target) => target.setAttribute('data-shown', 'true'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).setAttribute('data-shown', 'true');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [root]);
}
