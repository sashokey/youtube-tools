import { app, mobile, navigation } from './dom.ts';
import { enabled, listen } from './state.ts';

const browse = mobile ? 'ytm-browse' : 'ytd-browse';
const cards = mobile
  ? 'yt-lockup-view-model,ytm-rich-item-renderer,ytm-video-with-context-renderer,ytm-compact-video-renderer'
  : 'yt-lockup-view-model,ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer';
const panels = 'ytm-playlist-panel-renderer,ytd-playlist-panel-renderer,ytm-playlist-video-list-renderer,ytd-playlist-video-list-renderer';
const progress = '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment,ytd-thumbnail-overlay-resume-playback-renderer #progress,.ytwThumbnailOverlayResumePlaybackRendererThumbnailOverlayResumePlaybackProgress';

function scope(): string | undefined {
  const path = location.pathname;
  const type = path === '/' ? 'home' : /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)(?:\/|$)/.test(path) ? 'channels' : undefined;
  return type ? mobile ? browse : `${browse}[page-subtype="${type}"]` : undefined;
}

function mark(node: Element): void {
  node.toggleAttribute('data-ytt-progress', node instanceof HTMLElement && Number.parseFloat(node.style.width) > 0);
}

function scan(node: Element): void {
  if (node.matches(progress)) mark(node);
  node.querySelectorAll(progress).forEach(mark);
}

export function watched(): void {
  GM_addStyle(`[data-ytt-filter]:not([hidden]) :is(${cards}):not(:is(${panels}) *):not(:focus-within,:active):has([data-ytt-progress]){display:none!important}`);
  app(root => {
    const active = new Set<Element>();
    const changes = new MutationObserver(records => {
      for (const { target, addedNodes } of records) {
        if (target instanceof Element && target.matches(progress)) mark(target);
        for (const inserted of addedNodes) if (inserted instanceof Element) scan(inserted);
      }
    });

    function sync(): void {
      const view = scope();
      const found = new Set(view && !enabled('showWatched') ? root.querySelectorAll(view) : []);
      if (found.size === active.size && [...found].every(node => active.has(node))) return;
      changes.disconnect();
      for (const node of active) node.removeAttribute('data-ytt-filter');
      active.clear();
      for (const node of found) {
        scan(node);
        node.setAttribute('data-ytt-filter', '');
        changes.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
        active.add(node);
      }
    }

    const views = new MutationObserver(records => {
      if ([...active].some(node => !node.isConnected) || records.some(record =>
        record.type === 'attributes' && record.target instanceof Element && record.target.matches(browse) ||
        [...record.addedNodes].some(node => node instanceof Element && (node.matches(browse) || node.querySelector(browse))),
      )) sync();
    });
    views.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'page-subtype'] });
    navigation(sync);
    listen('showWatched', sync);
    sync();
  });
}
