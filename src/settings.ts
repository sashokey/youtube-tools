import { activation, app, mobile, navigation, svg, visible } from "./dom.ts";
import { message } from "./language.ts";
import { enabled, flip, listen } from "./state.ts";
import type { Setting } from "./state.ts";

const popupSelector = "ytd-popup-container";
const menuSelector =
  'ytd-multi-page-menu-renderer:is([menu-style="multi-page-menu-style-type-system"],:not([menu-style]))';
const entries = [
  {
    key: "showWatched",
    label: "watched",
    path: "M12 4.5C6.5 4.5 2 8 2 12s4.5 7.5 10 7.5S22 16 22 12 17.5 4.5 12 4.5Zm0 12a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z",
  },
  {
    key: "audioOnly",
    label: "audio",
    path: "M3 9v6h4l5 4V5L7 9H3Zm11 0v6a3 3 0 1 0 0-6Zm0-4v2a5 5 0 0 1 0 10v2a7 7 0 0 0 0-14Z",
  },
] as const;

const rules = `
  .ytt-setting-group{--ytt-setting-accent:var(--yt-sys-color-baseline--call-to-action,var(--yt-spec-call-to-action,Highlight));display:block}
  .ytt-setting{box-sizing:border-box;display:flex;align-items:center;gap:16px;inline-size:100%;block-size:40px;padding:0 16px;border:0;text-align:start;color:var(--yt-sys-color-baseline--text-primary,var(--yt-spec-text-primary,currentColor));background:transparent;cursor:pointer;font:400 14px/20px Roboto,Arial,sans-serif}
  ytm-settings .ytt-setting{block-size:48px}
  .ytt-setting:hover,.ytt-setting:focus-visible{background:var(--yt-sys-color-baseline--state-mono-standard-hovered,var(--yt-spec-badge-chip-background,rgba(127,127,127,.16)))}
  .ytt-setting:focus-visible{outline:2px solid var(--ytt-setting-accent);outline-offset:-2px}
  .ytt-setting:active{background:var(--yt-sys-color-baseline--state-mono-standard-pressed,var(--yt-spec-10-percent-layer,rgba(127,127,127,.28)))}
  .ytt-setting svg{width:24px;height:24px;flex:none;fill:currentColor}
  .ytt-setting-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ytt-setting-switch{position:relative;inline-size:36px;block-size:20px;flex:none}
  .ytt-setting-switch::before,.ytt-setting-switch::after{content:"";position:absolute;border-radius:16px;background:currentColor}
  .ytt-setting-switch::before{inset-block-start:3px;inset-inline-start:4px;inline-size:28px;block-size:14px;opacity:.55}
  .ytt-setting-switch::after{inset-block-start:0;inset-inline-start:0;inline-size:20px;block-size:20px}
  .ytt-setting[aria-checked=true] .ytt-setting-switch::before,.ytt-setting[aria-checked=true] .ytt-setting-switch::after{background:var(--ytt-setting-accent)}
  .ytt-setting[aria-checked=true] .ytt-setting-switch::after{inset-inline-start:16px}
`;

function containsSelector(node: Node, selector: string): boolean {
  return (
    node instanceof Element &&
    (node.matches(selector) ||
      Boolean(node.firstElementChild && node.querySelector(selector)))
  );
}

function desktopAnchor(menus: readonly Element[]): Element | undefined {
  for (const scope of menus) {
    if (
      scope.closest('tp-yt-iron-dropdown[aria-hidden="true"]') ||
      !visible(scope)
    )
      continue;
    const rows = [
      ...scope.querySelectorAll("ytd-compact-link-renderer"),
    ].filter((row) => {
      const data: unknown = Reflect.get(row, "data");
      if (
        !data ||
        typeof data !== "object" ||
        !("icon" in data) ||
        !data.icon ||
        typeof data.icon !== "object"
      )
        return false;
      return "iconType" in data.icon && data.icon.iconType === "KEYBOARD";
    });
    const [anchor] = rows;
    if (rows.length === 1 && anchor && visible(anchor)) return anchor;
  }
}

export function settings(): void {
  GM_addStyle(rules);
  const controls = new Map<Setting, HTMLButtonElement>();
  let mounted: Element | null = null;

  function mount(menus: readonly Element[] = []): void {
    const scope =
      mobile && location.pathname === "/select_site"
        ? document.querySelector("ytm-settings")
        : null;
    const anchor = mobile ? undefined : desktopAnchor(menus);
    if (!anchor && (!scope || !visible(scope))) {
      if (mounted) {
        mounted.remove();
        mounted = null;
        controls.clear();
      }
      return;
    }
    if (
      mounted &&
      (anchor
        ? mounted.previousElementSibling === anchor
        : mounted.parentElement === scope)
    )
      return;
    mounted?.remove();
    const group = document.createElement("div");
    group.className = "ytt-setting-group";
    mounted = group;
    for (const { key, label, path } of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ytt-setting";
      button.setAttribute("role", mobile ? "switch" : "menuitemcheckbox");
      button.setAttribute("aria-checked", String(enabled(key)));
      const text = document.createElement("span");
      text.className = "ytt-setting-title";
      text.textContent = message(label);
      const knob = document.createElement("span");
      knob.className = "ytt-setting-switch";
      knob.setAttribute("aria-hidden", "true");
      button.append(svg(path), text, knob);
      activation(button, () => flip(key));
      controls.set(key, button);
      group.append(button);
    }
    if (anchor) anchor.after(group);
    else scope?.append(group);
  }

  for (const { key } of entries)
    listen(key, () =>
      controls.get(key)?.setAttribute("aria-checked", String(enabled(key))),
    );
  if (mobile) {
    app((root) => {
      const observer = new MutationObserver(() => mount());
      let watching = false;
      function sync(): void {
        const active = location.pathname === "/select_site";
        if (active !== watching) {
          watching = active;
          if (active)
            observer.observe(root, {
              subtree: true,
              childList: true,
              attributes: true,
              attributeFilter: ["hidden", "style", "class"],
            });
          else observer.disconnect();
        }
        mount();
      }
      navigation(sync);
      sync();
    });
  } else {
    let observed: Element | null = null;
    let menus: Element[] = [];
    let deadline: number | undefined;
    const observer = new MutationObserver((records) => {
      const selector =
        observed === document.body ? popupSelector : menuSelector;
      const changed = records.some(
        ({ target, type, attributeName, addedNodes, removedNodes }) =>
          menus.some(
            (menu) =>
              menu.contains(target) ||
              (type === "attributes" && target.contains(menu)),
          ) ||
          (attributeName === "menu-style" &&
            target instanceof Element &&
            target.matches(menuSelector)) ||
          [...addedNodes, ...removedNodes].some((node) =>
            containsSelector(node, selector),
          ),
      );
      if (changed) sync();
    });
    const popupParents = new MutationObserver((records) => {
      const changed = records.some(({ addedNodes, removedNodes }) =>
        [...addedNodes, ...removedNodes].some((node) =>
          containsSelector(node, `ytd-app,${popupSelector}`),
        ),
      );
      if (!changed && !(observed && !observed.isConnected)) return;
      const popup = document.querySelector(popupSelector);
      if (!popup || popup === observed) watchPopupParents(popup);
      sync();
    });

    function watchPopupParents(popup: Element | null): void {
      popupParents.disconnect();
      for (
        let parent: Element | null =
          popup?.parentElement ??
          document.querySelector("ytd-app") ??
          document.body;
        parent;
        parent = parent.parentElement
      ) {
        popupParents.observe(parent, { childList: true });
        if (parent === document.body) break;
      }
    }

    function stopObserving(): void {
      observer.disconnect();
      window.clearTimeout(deadline);
      deadline = undefined;
      observed = null;
      menus = [];
    }

    function observe(root: Element): void {
      if (observed === root) return;
      stopObserving();
      observed = root;
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          "hidden",
          "opened",
          "aria-hidden",
          "style",
          "class",
          "menu-style",
        ],
      });
      if (root !== document.body) watchPopupParents(root);
    }

    function sync(): void {
      const popup = document.querySelector(popupSelector);
      if (popup) observe(popup);
      else if (observed && observed !== document.body) stopObserving();
      menus = popup ? [...popup.querySelectorAll(menuSelector)] : [];
      mount(menus);
    }

    document.addEventListener(
      "iron-overlay-opened",
      (event) => {
        const [overlay] = event.composedPath();
        if (
          overlay instanceof Element &&
          overlay.closest(popupSelector) &&
          containsSelector(overlay, menuSelector)
        )
          sync();
      },
      true,
    );
    document.addEventListener(
      "click",
      (event) => {
        if (
          !event
            .composedPath()
            .some((node) => node instanceof Element && node.id === "avatar-btn")
        )
          return;
        const popup = document.querySelector(popupSelector);
        observe(popup ?? document.body);
        if (!popup) {
          window.clearTimeout(deadline);
          deadline = window.setTimeout(stopObserving, 3000);
        }
        window.setTimeout(sync, 0);
      },
      true,
    );
    app(() => {
      sync();
      if (!observed) watchPopupParents(null);
    });
  }
}
