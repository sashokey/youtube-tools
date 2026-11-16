import { activation, app, mobile, navigation, svg, visible } from './dom.ts';
import { message } from './language.ts';

const cardSelector = mobile
  ? 'yt-lockup-view-model,ytm-video-with-context-renderer,ytm-compact-video-renderer'
  : 'yt-lockup-view-model,ytd-video-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer';
const thumbnail = 'a.ytLockupViewModelContentImage,a#thumbnail,a.media-item-thumbnail-container,a[href^="/watch?v="]:has(img)';
const triggerSelector = '.ytLockupMetadataViewModelMenuButton button,ytd-menu-renderer button,ytm-menu button,#menu button,button[aria-label="Action menu"]';
const popups = 'yt-sheet-view-model,ytd-menu-popup-renderer,ytm-menu-popup-renderer,bottom-sheet-container[role=dialog]';
const nativeRow = 'yt-list-item-view-model,ytd-menu-service-item-renderer,ytm-menu-service-item-renderer';
const nativeControl = '[role=menuitem],ytd-menu-service-item-renderer,ytm-menu-service-item-renderer,tp-yt-paper-item';
const ignored = 'ytd-ad-slot-renderer,ytd-promoted-sparkles-web-renderer,ytm-promoted-sparkles-web-renderer,ytd-display-ad-renderer,ytm-display-ad-renderer';

const icons = {
  interest: 'M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 018.246 12.605L4.755 6.661A8.99 8.99 0 0112 3ZM3.754 8.393l15.491 8.944A9 9 0 013.754 8.393Z',
  channel: 'M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 110 18.001A9 9 0 0112 3Zm4 8H8a1 1 0 000 2h8a1 1 0 000-2Z',
};
type Action = keyof typeof icons;

type Item = { element: Element; anchor: HTMLAnchorElement; panel: HTMLDivElement };

const styles = `
  .ytt-feedback-card{position:relative!important}
  .ytt-feedback{position:absolute;z-index:8;display:flex;flex-direction:column;gap:4px;opacity:0;visibility:hidden;pointer-events:none}
  .ytt-feedback-card:has(.ytt-feedback-thumbnail:hover) .ytt-feedback,.ytt-feedback-card:focus-within .ytt-feedback,.ytt-feedback:hover{opacity:1;visibility:visible}
  ${mobile ? '.ytt-feedback{opacity:1;visibility:visible}' : '@media(hover:none),(pointer:coarse){.ytt-feedback{opacity:1;visibility:visible}}'}
  button.ytt-action{position:relative;box-sizing:border-box;display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:50%;color:var(--yt-spec-static-white,#fff);background:var(--yt-spec-static-overlay-background-heavy,rgba(0,0,0,.66));cursor:pointer;pointer-events:auto}
  button.ytt-action:hover,button.ytt-action:active{background:var(--yt-spec-static-overlay-background-solid,rgba(0,0,0,.85))}
  button.ytt-action:focus-visible{outline:2px solid var(--yt-spec-static-white,#fff);outline-offset:2px}
  .ytt-action svg{width:24px;height:24px;fill:currentColor;pointer-events:none}
  .ytt-action[data-unavailable]::after{content:attr(title);position:absolute;inset-inline-end:calc(100% + 6px);padding:4px 8px;border-radius:4px;background:var(--yt-spec-tooltip-background,#212121);color:#fff;font:400 12px Roboto,Arial,sans-serif;white-space:nowrap}
  html[data-ytt-feedback-open] :is(${popups}){opacity:0!important;pointer-events:none!important}
`;

function normalize(text: string): string {
  return text.normalize('NFKC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

function currentMenu(): Element | undefined {
  return [...document.querySelectorAll(popups)].find(visible);
}

function matchingAction(menu: Element, action: Action): HTMLElement | undefined {
  const rows = new Map<Element, HTMLElement>();
  for (const node of menu.querySelectorAll(nativeControl)) {
    if (!(node instanceof HTMLElement) || !visible(node)) continue;
    const row = node.closest(nativeRow) ?? node;
    const prior = rows.get(row);
    if (!prior || prior.contains(node)) rows.set(row, node);
  }
  const byIcon = [...rows].filter(([row]) => [...row.querySelectorAll('path')].some(path => path.getAttribute('d') === icons[action]));
  if (byIcon.length) return byIcon.length === 1 ? byIcon[0]?.[1] : undefined;
  const names = action === 'interest' ? [message(action), 'Not interested', 'Не интересует']
    : [message(action), "Don't recommend channel", 'Не рекомендовать видео с этого канала', 'Не рекомендовать канал'];
  const targets = new Set(names.map(normalize));
  const matched = [...rows.values()].filter(node => targets.has(normalize(node.innerText)));
  return matched.length === 1 ? matched[0] : undefined;
}

function waitForMenuAction(action: Action, signal: AbortSignal): Promise<{ popup: Element | undefined; entry: HTMLElement | undefined }> {
  return new Promise(resolve => {
    let popup: Element | undefined;
    const changes = new MutationObserver(check);
    const timer = window.setTimeout(() => finish(), 1600);

    function finish(entry?: HTMLElement): void {
      window.clearTimeout(timer);
      changes.disconnect();
      signal.removeEventListener('abort', cancelled);
      document.removeEventListener('transitionend', check, true);
      resolve({ popup, entry });
    }

    function cancelled(): void { finish(); }
    function check(): void {
      const open = currentMenu();
      if (popup && open !== popup) {
        popup = undefined;
        finish();
        return;
      }
      popup ??= open;
      const entry = popup && matchingAction(popup, action);
      if (entry) finish(entry);
    }

    if (signal.aborted) { finish(); return; }
    signal.addEventListener('abort', cancelled, { once: true });
    document.addEventListener('transitionend', check, true);
    changes.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'aria-hidden'] });
    check();
  });
}

function close(menu: Element): void {
  const sheet = menu.closest('bottom-sheet-container');
  const button = sheet?.querySelector('button.close-button,button.ytWebScrimHiddenButton');
  if (button instanceof HTMLButtonElement) { button.click(); return; }
  const dropdown = menu.closest('tp-yt-iron-dropdown');
  const dismiss: unknown = dropdown && Reflect.get(dropdown, 'close');
  if (typeof dismiss === 'function') Reflect.apply(dismiss, dropdown, []);
  else document.body.click();
}

function activeRoute(): boolean {
  return /^(?:\/(?:results|watch)?\/?|\/feed\/(?:subscriptions|trending|explore)\/?)$/.test(location.pathname);
}

function place(item: Item): void {
  const anchor = item.anchor.getBoundingClientRect();
  if (anchor.width === 0 || anchor.height === 0) return;
  const origin = item.element.getBoundingClientRect();
  const size = 32;
  const rtl = getComputedStyle(item.element).direction === 'rtl';
  const x = Math.max(2, Math.min(document.documentElement.clientWidth - size - 2, rtl ? anchor.left + 4 : anchor.right - size - 4));
  let top = anchor.top + 4;
  for (const native of item.anchor.querySelectorAll('yt-thumbnail-hover-overlay-toggle-actions-view-model button,ytd-thumbnail-overlay-toggle-button-renderer')) {
    const box = native.getBoundingClientRect();
    if (box.width && box.height) top = Math.max(top, box.bottom + 4);
  }
  item.panel.style.left = `${x - origin.left}px`;
  item.panel.style.top = `${top - origin.top}px`;
}

export function feedback(): void {
  GM_addStyle(styles);
  app(root => {
    const items = new Map<Element, Item>();
    const notices = new WeakMap<HTMLButtonElement, number>();
    let operation: AbortController | undefined;
    let observing = false;

    function rename(button: HTMLButtonElement, text: string): void {
      button.title = text;
      button.setAttribute('aria-label', text);
    }

    function unavailable(button: HTMLButtonElement, action: Action): void {
      if (!button.isConnected) return;
      window.clearTimeout(notices.get(button));
      rename(button, message('unavailable'));
      button.dataset.unavailable = '';
      notices.set(button, window.setTimeout(() => {
        rename(button, message(action));
        delete button.dataset.unavailable;
        notices.delete(button);
      }, 1550));
    }

    async function run(item: Item, button: HTMLButtonElement, action: Action): Promise<void> {
      if (operation) return;
      const trigger = item.element.querySelector(triggerSelector);
      if (!(trigger instanceof HTMLElement) || currentMenu()) { unavailable(button, action); return; }
      const controller = new AbortController();
      operation = controller;
      const route = location.href;
      const target = item.anchor.href;
      const clear = () => document.documentElement.removeAttribute('data-ytt-feedback-open');
      function interrupt(event: Event): void {
        if (!event.isTrusted) return;
        controller.abort();
        clear();
      }
      for (const type of ['pointerdown', 'keydown', 'click']) document.addEventListener(type, interrupt, { capture: true, signal: controller.signal });
      document.documentElement.setAttribute('data-ytt-feedback-open', '');
      try {
        trigger.click();
        const { popup, entry } = await waitForMenuAction(action, controller.signal);
        if (controller.signal.aborted || route !== location.href || !root.contains(item.element) ||
          !item.element.contains(trigger) || !item.element.contains(item.anchor) || item.anchor.href !== target) return;
        controller.abort();
        if (popup && currentMenu() !== popup) return;
        if (entry && popup?.contains(entry)) entry.click();
        else {
          if (popup) close(popup);
          unavailable(button, action);
        }
      } finally {
        controller.abort();
        operation = undefined;
        clear();
      }
    }

    function remove(item: Item): void {
      item.panel.remove();
      item.anchor.classList.remove('ytt-feedback-thumbnail');
      item.element.classList.remove('ytt-feedback-card');
      items.delete(item.element);
    }

    function mount(element: Element): void {
      const old = items.get(element);
      const anchor = element.querySelector(thumbnail);
      const suitable = anchor instanceof HTMLAnchorElement && anchor.closest(cardSelector) === element &&
        root.contains(element) && !element.closest(ignored) && !element.querySelector(ignored);
      if (old) {
        if (suitable && anchor === old.anchor) { place(old); return; }
        remove(old);
      }
      if (!suitable) return;
      const panel = document.createElement('div');
      panel.className = 'ytt-feedback';
      const item = { element, anchor, panel };
      for (const action of ['interest', 'channel'] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ytt-action ytSpecButtonShapeNextHost ytSpecButtonShapeNextIconButton ytSpecButtonShapeNextOverlayDark';
        rename(button, message(action));
        button.append(svg(icons[action]));
        activation(button, () => void run(item, button, action).catch(() => unavailable(button, action)));
        panel.append(button);
      }
      items.set(element, item);
      element.classList.add('ytt-feedback-card');
      anchor.classList.add('ytt-feedback-thumbnail');
      element.append(panel);
      place(item);
    }

    const observer = new MutationObserver(records => {
      const updated = new Set<Element>();
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element) || node.matches('.ytt-feedback')) continue;
          if (node.matches(cardSelector)) updated.add(node);
          node.querySelectorAll(cardSelector).forEach(card => updated.add(card));
        }
        if (record.target instanceof Element && !record.target.closest('.ytt-feedback')) {
          const parent = record.target.closest(cardSelector);
          if (parent) updated.add(parent);
        }
      }
      for (const item of items.values()) if (!root.contains(item.element)) remove(item);
      updated.forEach(mount);
    });

    function sync(): void {
      if (!activeRoute()) {
        if (!observing) return;
        observing = false;
        observer.disconnect();
        operation?.abort();
        for (const item of items.values()) remove(item);
        return;
      }
      if (!observing) {
        observing = true;
        observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['href', 'hidden'], childList: true });
      }
      root.querySelectorAll(cardSelector).forEach(mount);
    }

    window.addEventListener('resize', () => items.forEach(place), { passive: true });
    root.addEventListener('focusin', event => {
      const selected = event.target instanceof Element ? event.target.closest(cardSelector) : null;
      const item = selected && items.get(selected);
      if (item) place(item);
    });
    root.addEventListener('pointerover', event => {
      const selected = event.target instanceof Element ? event.target.closest(cardSelector) : null;
      const item = selected && items.get(selected);
      if (item) place(item);
    }, { passive: true });
    navigation(sync);
    sync();
  });
}
