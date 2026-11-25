import { useSyncExternalStore } from 'react';

/** Tiny hash router: keeps the deployed build working on any static host without rewrites. */
export type Route =
  | { name: 'menu' }
  | { name: 'options' }
  | { name: 'play' }
  | { name: 'result' }
  | { name: 'log'; tab: 'ranking' | 'history' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  switch (path) {
    case 'options':
      return { name: 'options' };
    case 'play':
      return { name: 'play' };
    case 'result':
      return { name: 'result' };
    case 'ranking':
      return { name: 'log', tab: 'ranking' };
    case 'history':
      return { name: 'log', tab: 'history' };
    default:
      return { name: 'menu' };
  }
}

export function routeToHash(r: Route): string {
  return r.name === 'log' ? `#/${r.tab}` : `#/${r.name}`;
}

export function navigate(r: Route, replace = false): void {
  const hash = routeToHash(r);
  if (window.location.hash === hash) return;
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  window.addEventListener('popstate', cb);
  return () => {
    window.removeEventListener('hashchange', cb);
    window.removeEventListener('popstate', cb);
  };
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash);
}
