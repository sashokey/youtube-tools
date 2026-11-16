import { activation, app, mobile, navigation, svg, visible } from './dom.ts';
import { message } from './language.ts';
import { enabled, flip, listen } from './state.ts';
import type { Setting } from './state.ts';

const menu = 'ytd-popup-container ytd-multi-page-menu-renderer';
const entries = [
  { key: 'showWatched', label: 'watched', path: 'M12 4.5C6.5 4.5 2 8 2 12s4.5 7.5 10 7.5S22 16 22 12 17.5 4.5 12 4.5Zm0 12a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z' },
  { key: 'audioOnly', label: 'audio', path: 'M3 9v6h4l5 4V5L7 9H3Zm11 0v6a3 3 0 1 0 0-6Zm0-4v2a5 5 0 0 1 0 10v2a7 7 0 0 0 0-14Z' },
] as const;

const rules = `
  .ytt-setting-group{display:block}
  .ytt-setting{box-sizing:border-box;display:flex;align-items:center;gap:16px;inline-size:100%;block-size:40px;padding:0 16px;border:0;text-align:start;color:var(--yt-spec-text-primary,CanvasText);background:transparent;cursor:pointer;font:400 14px/20px Roboto,Arial,sans-serif}
  ytm-settings .ytt-setting{block-size:48px}
  .ytt-setting:hover,.ytt-setting:focus-visible{background:var(--yt-spec-badge-chip-background,rgba(127,127,127,.16))}
  .ytt-setting:focus-visible{outline:2px solid var(--yt-spec-call-to-action,Highlight);outline-offset:-2px}
  .ytt-setting:active{background:var(--yt-spec-10-percent-layer,rgba(127,127,127,.28))}
  .ytt-setting svg{width:24px;height:24px;flex:none;fill:currentColor}
  .ytt-setting-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ytt-setting-switch{position:relative;inline-size:36px;block-size:20px;flex:none}
  .ytt-setting-switch::before,.ytt-setting-switch::after{content:"";position:absolute;border-radius:16px;background:var(--yt-spec-text-secondary,GrayText)}
  .ytt-setting-switch::before{inset-block-start:3px;inset-inline-start:4px;inline-size:28px;block-size:14px;opacity:.55}
  .ytt-setting-switch::after{inset-block-start:0;inset-inline-start:0;inline-size:20px;block-size:20px;background:var(--yt-spec-text-primary,CanvasText)}
  .ytt-setting[aria-checked=true] .ytt-setting-switch::before,.ytt-setting[aria-checked=true] .ytt-setting-switch::after{background:var(--yt-spec-call-to-action,Highlight)}
  .ytt-setting[aria-checked=true] .ytt-setting-switch::after{inset-inline-start:16px}
`;

function keyboardRow(scope: Element): Element | undefined {
  return [...scope.querySelectorAll('ytd-compact-link-renderer')].find(row => {
    const data: unknown = Reflect.get(row, 'data');
    if (!data || typeof data !== 'object' || !('icon' in data) || !data.icon || typeof data.icon !== 'object') return false;
    return 'iconType' in data.icon && data.icon.iconType === 'KEYBOARD';
  });
}

export function settings(): void {
  GM_addStyle(rules);
  const controls = new Map<Setting, HTMLButtonElement>();
  let mounted: Element | null = null;

  function mount(): boolean {
    const scope = mobile
      ? location.pathname === '/select_site' && document.querySelector('ytm-settings')
      : [...document.querySelectorAll(menu)].find(element => visible(element) && keyboardRow(element));
    if (!scope || !visible(scope)) return false;
    const anchor = mobile ? undefined : keyboardRow(scope);
    if (!mobile && !anchor) return false;
    if (mounted?.isConnected && scope.contains(mounted)) return true;
    mounted?.remove();
    const group = document.createElement('div');
    group.className = 'ytt-setting-group';
    mounted = group;
    for (const { key, label, path } of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ytt-setting';
      button.setAttribute('role', mobile ? 'switch' : 'menuitemcheckbox');
      button.setAttribute('aria-checked', String(enabled(key)));
      const text = document.createElement('span');
      text.className = 'ytt-setting-title';
      text.textContent = message(label);
      const knob = document.createElement('span');
      knob.className = 'ytt-setting-switch';
      knob.setAttribute('aria-hidden', 'true');
      button.append(svg(path), text, knob);
      activation(button, () => flip(key));
      controls.set(key, button);
      group.append(button);
    }
    if (anchor) anchor.after(group);
    else scope.append(group);
    return true;
  }

  for (const { key } of entries) listen(key, () => controls.get(key)?.setAttribute('aria-checked', String(enabled(key))));
  if (mobile) {
    app(root => {
      const observer = new MutationObserver(mount);
      observer.observe(root, { subtree: true, childList: true });
    });
    navigation(mount);
  } else {
    let deadline: number | undefined;
    const observer = new MutationObserver(() => {
      if (mount()) stop();
    });
    function stop(): void {
      observer.disconnect();
      window.clearTimeout(deadline);
    }
    document.addEventListener('iron-overlay-opened', mount, true);
    document.addEventListener('click', event => {
      if (!event.composedPath().some(node => node instanceof Element && node.id === 'avatar-btn')) return;
      stop();
      observer.observe(document.querySelector('ytd-popup-container') ?? document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['hidden', 'opened', 'aria-hidden', 'style'],
      });
      deadline = window.setTimeout(stop, 3000);
      window.setTimeout(() => {
        if (mount()) stop();
      }, 0);
    }, true);
  }
  mount();
}
