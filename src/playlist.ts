import { app, mobile, navigation, ready } from './dom.ts';

const flag = 'canAutoAdvance_';

function playlistWatch(): boolean {
  return location.pathname === '/watch' && Boolean(new URLSearchParams(location.search).get('list'));
}

function preventAdvance(owner: unknown): (() => void) | undefined {
  if (typeof owner !== 'object' || !owner) return;
  const original = Object.getOwnPropertyDescriptor(owner, flag);
  if (!original?.configurable || !original.writable || typeof original.value !== 'boolean') return;
  let value: unknown = original.value;
  const read = () => playlistWatch() ? false : value;
  Object.defineProperty(owner, flag, {
    configurable: true,
    enumerable: original.enumerable ?? false,
    get: read,
    set(next: unknown) { value = next; },
  });
  return () => {
    if (Object.getOwnPropertyDescriptor(owner, flag)?.get === read) Object.defineProperty(owner, flag, { ...original, value });
  };
}

function desktop(root: Element): void {
  let controller: unknown;
  let restore: (() => void) | undefined;
  let watching = false;
  const observer = new MutationObserver(records => {
    if (!restore || records.some(({ addedNodes, removedNodes }) =>
      [...addedNodes, ...removedNodes].some(node => node instanceof Element &&
        (node.matches('yt-playlist-manager') || Boolean(node.querySelector('yt-playlist-manager')))),
    )) check();
  });

  function check(): void {
    if (!playlistWatch()) {
      observer.disconnect();
      watching = false;
      restore?.();
      restore = undefined;
      controller = undefined;
      return;
    }
    if (!watching) {
      observer.observe(root, { subtree: true, childList: true });
      watching = true;
    }
    const manager = root.querySelector('yt-playlist-manager') ?? document.querySelector('yt-playlist-manager');
    const selected: unknown = manager && (Reflect.get(manager, 'polymerController') ?? manager);
    if (selected === controller && restore) return;
    restore?.();
    controller = selected;
    try { restore = preventAdvance(controller); } catch { restore = undefined; }
  }

  navigation(check);
  document.addEventListener('ended', check, true);
  void customElements.whenDefined('yt-playlist-manager').then(check);
  check();
}

export function playlist(): void {
  if (!mobile) {
    ready(() => app(desktop));
    return;
  }
  window.addEventListener('player-state-change', event => {
    const info: unknown = event instanceof CustomEvent ? event.detail : undefined;
    if (playlistWatch() && info && typeof info === 'object' && 'state' in info && info.state === 0) event.stopPropagation();
  }, true);
}
