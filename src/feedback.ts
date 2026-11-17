import { activation, app, mobile, navigation, svg, visible } from "./dom.ts";
import { feedbackLabels, message } from "./language.ts";

const cardSelector = mobile
  ? "yt-lockup-view-model,ytm-video-with-context-renderer,ytm-compact-video-renderer"
  : "yt-lockup-view-model,ytd-video-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer,ytd-rich-item-renderer";
const desktopFeed = "ytd-page-manager,#page-manager";
const thumbnail =
  'a.ytLockupViewModelContentImage,a#thumbnail,a.media-item-thumbnail-container,a[href^="/watch?v="]:has(img)';
const picture = "yt-thumbnail-view-model,ytd-thumbnail";
const nativeActions = "yt-thumbnail-hover-overlay-toggle-actions-view-model";
const hiddenActions =
  ":is(.ytThumbnailHoverOverlayToggleActionsViewModelHidden,.ytThumbnailHoverOverlayToggleActionsViewModelHiddenGated)";
const nativeBackground =
  "ytThumbnailHoverOverlayToggleActionsViewModelOverlayBackground";
const previewHost = "#video-preview";
const activePreview = "ytd-video-preview.ytdVideoPreviewActive";
const triggerSelector =
  '.ytLockupMetadataViewModelMenuButton button,ytd-menu-renderer button,ytm-menu button,#menu button,button[aria-label="Action menu"]';
const legacyMenu = "div#menu.menu-container:has(>.menu-content[role=dialog])";
const popups = `yt-sheet-view-model,ytd-menu-popup-renderer,ytm-menu-popup-renderer,bottom-sheet-container[role=dialog],${legacyMenu}`;
const nativeRow =
  "yt-list-item-view-model,ytd-menu-service-item-renderer,ytm-menu-service-item-renderer";
const nativeControl =
  "[role=menuitem],[role=menuitem] button,ytd-menu-service-item-renderer,ytd-menu-service-item-renderer>button,ytm-menu-service-item-renderer,ytm-menu-service-item-renderer>button,tp-yt-paper-item";
const disabled = ':disabled,[disabled],[aria-disabled="true" i],[inert]';
const historyRenderer =
  'ytd-browse[page-subtype="history"],ytm-browse[page-subtype="history"]';
const ignored =
  "ytd-ad-slot-renderer,ytd-promoted-sparkles-web-renderer,ytm-promoted-sparkles-web-renderer,ytd-display-ad-renderer,ytm-display-ad-renderer";

const icons = {
  interest:
    "M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 018.246 12.605L4.755 6.661A8.99 8.99 0 0112 3ZM3.754 8.393l15.491 8.944A9 9 0 013.754 8.393Z",
  channel:
    "M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 110 18.001A9 9 0 0112 3Zm4 8H8a1 1 0 000 2h8a1 1 0 000-2Z",
};
type Action = keyof typeof icons;

type Item = {
  element: Element;
  anchor: HTMLAnchorElement;
  surface: Element;
  panel: HTMLDivElement;
};
type Preview = { item: Item; target: HTMLElement };
type Operation = {
  item: Item;
  trigger: HTMLElement;
  route: string;
  href: string;
  hrefAttribute: string | null;
  controller: AbortController;
};

const styles = `
  .ytt-feedback-card{position:relative!important${mobile ? ";isolation:isolate" : ""}}
  .ytt-feedback{position:absolute;z-index:8;display:flex;flex-direction:column;gap:4px;opacity:0;visibility:hidden;pointer-events:none}
  .ytt-feedback[hidden]{display:none!important}
  .ytt-feedback-row{flex-direction:row}
  .ytt-feedback-card:has(.ytt-feedback-thumbnail:hover):not(:has(${nativeActions}${hiddenActions}))>.ytt-feedback,.ytt-feedback-card:focus-within>.ytt-feedback,.ytt-feedback:hover,.ytt-feedback-preview{opacity:1;visibility:visible}
  .ytt-feedback-card:has(>.ytt-feedback:hover,${nativeActions}:hover) ${nativeActions}${hiddenActions}{opacity:1;visibility:visible}
  ${mobile ? ".ytt-feedback{opacity:1;visibility:visible}" : "@media(hover:none),(pointer:coarse){.ytt-feedback{opacity:1;visibility:visible}}"}
  button.ytt-action{position:relative;box-sizing:border-box;display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:50%;color:var(--yt-spec-static-white,#fff);cursor:pointer;pointer-events:auto}
  :where(button.ytt-action){background-color:rgba(0,0,0,.6)}
  :where(button.ytt-action):hover,:where(button.ytt-action):active{background-color:rgba(40,40,40,.6)}
  button.ytt-action:focus-visible{outline:2px solid var(--yt-spec-static-white,#fff);outline-offset:2px}
  .ytt-action svg{width:24px;height:24px;fill:currentColor;pointer-events:none}
  .ytt-action[data-unavailable]::after{content:attr(title);position:absolute;inset-inline-end:calc(100% + 6px);padding:4px 8px;border-radius:4px;background:var(--yt-spec-tooltip-background,#212121);color:#fff;font:400 12px Roboto,Arial,sans-serif;white-space:nowrap}
  [data-ytt-feedback-menu]{opacity:0!important;pointer-events:none!important}
`;

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function openMenus(): Element[] {
  const menus = [...document.querySelectorAll(popups)].filter(visible);
  return menus.filter(
    (menu) => !menus.some((other) => other !== menu && menu.contains(other)),
  );
}

function openedLegacyMenu(
  trigger: HTMLElement,
  route: string,
): Element | undefined {
  if (!mobile || !trigger.closest("ytm-menu")) return;
  const destination = new URL("#menu", route).href;
  if (destination === route || destination !== location.href) return;
  const menus = openMenus();
  const [menu] = menus;
  if (menus.length === 1 && menu?.matches(legacyMenu)) return menu;
}

function property(value: unknown, key: string): unknown {
  try {
    if (value && typeof value === "object") return Reflect.get(value, key);
  } catch {}
  return undefined;
}

function path(value: unknown, ...keys: string[]): unknown {
  return keys.reduce(property, value);
}

function feedbackToken(data: unknown): string | undefined {
  const token = path(
    data,
    "rendererContext",
    "commandContext",
    "onTap",
    "innertubeCommand",
    "feedbackEndpoint",
    "feedbackToken",
  );
  return typeof token === "string" && token ? token : undefined;
}

type MenuMarker = { selector: string; release(): void };
type MenuIdentity = { tokens: Set<string>; marker?: MenuMarker };

function markFeedbackRows(rows: object[]): MenuMarker | undefined {
  if (!rows.length || typeof globalThis.crypto?.randomUUID !== "function")
    return;
  const prefix = `ytt-feedback-${crypto.randomUUID()}-`;
  const marked: { row: object; id: string }[] = [];
  for (const [index, row] of rows.entries()) {
    try {
      if (Reflect.has(row, "targetId")) continue;
      const id = `${prefix}${index}`;
      if (
        !Reflect.defineProperty(row, "targetId", {
          configurable: true,
          enumerable: true,
          writable: true,
          value: id,
        })
      )
        continue;
      marked.push({ row, id });
    } catch {}
  }
  if (!marked.length) return;
  const selector = `[data-target-id^="${prefix}"]`;
  return {
    selector,
    release() {
      for (const { row, id } of marked) {
        try {
          if (property(row, "targetId") === id)
            Reflect.deleteProperty(row, "targetId");
        } catch {}
      }
      document
        .querySelectorAll(selector)
        .forEach((element) => element.removeAttribute("data-target-id"));
    },
  };
}

function menuIdentity(trigger: HTMLElement): MenuIdentity {
  const items = path(
    trigger.closest("button-view-model"),
    "data",
    "onTap",
    "innertubeCommand",
    "showSheetCommand",
    "panelLoadingStrategy",
    "inlineContent",
    "sheetViewModel",
    "content",
    "listViewModel",
    "listItems",
  );
  const tokens = new Set<string>();
  if (!Array.isArray(items)) return { tokens };
  const rows: unknown[] = items;
  const candidates: object[] = [];
  for (const item of rows) {
    const row = property(item, "listItemViewModel");
    if (!row || typeof row !== "object") continue;
    const token = feedbackToken(row);
    if (!token) continue;
    tokens.add(token);
    if (mobile) candidates.push(row);
  }
  const marker = markFeedbackRows(candidates);
  return marker ? { tokens, marker } : { tokens };
}

function menuOwner(
  menu: Element,
  operation: Operation,
  { tokens, marker }: MenuIdentity,
): "anchor" | "row" | "conflict" | undefined {
  const { item, trigger } = operation;
  const targets = [
    property(menu, "positionTarget"),
    property(menu.closest("tp-yt-iron-dropdown"), "positionTarget"),
  ];
  const anchor = targets.find(
    (node) =>
      node instanceof Element &&
      node !== document.body &&
      node !== document.documentElement,
  );
  if (
    anchor instanceof Element &&
    (!item.element.contains(anchor) ||
      !(anchor.contains(trigger) || trigger.contains(anchor)))
  )
    return "conflict";
  const present = tokens.size
    ? [...menu.querySelectorAll(nativeRow)]
        .filter(visible)
        .flatMap((row) => feedbackToken(property(row, "data")) ?? [])
    : [];
  if (present.some((token) => !tokens.has(token))) return "conflict";
  if (anchor instanceof Element) return "anchor";
  const markedRow = marker && menu.querySelector(marker.selector);
  if (present.length || (markedRow && visible(markedRow))) return "row";
}

function matchingAction(
  menu: Element,
  action: Action,
): HTMLElement | undefined {
  const rows = new Map<Element, HTMLElement>();
  for (const node of menu.querySelectorAll(nativeControl)) {
    if (!(node instanceof HTMLElement) || !visible(node)) continue;
    const row =
      node.closest(nativeRow) ?? node.closest("[role=menuitem]") ?? node;
    const prior = rows.get(row);
    if (!prior || prior.contains(node)) rows.set(row, node);
  }
  const enabled = [...rows].filter(([, control]) => !control.closest(disabled));
  const byIcon = enabled.filter(([row]) =>
    [...row.querySelectorAll("path")].some(
      (path) => path.getAttribute("d") === icons[action],
    ),
  );
  if (byIcon.length) return byIcon.length === 1 ? byIcon[0]?.[1] : undefined;
  const targets = new Set(feedbackLabels(action).map(normalize));
  const matched = enabled.filter(([row, control]) =>
    targets.has(
      normalize(
        control.innerText || (row instanceof HTMLElement ? row.innerText : ""),
      ),
    ),
  );
  return matched.length === 1 ? matched[0]?.[1] : undefined;
}

function waitForMenuAction(
  signal: AbortSignal,
  ownedMenus: () => Element[],
  selectedEntry: (menu: Element) => HTMLElement | undefined,
): Promise<{ popup: Element | undefined; entry: HTMLElement | undefined }> {
  return new Promise((resolve) => {
    let popup: Element | undefined;
    const changes = new MutationObserver(check);
    const timer = window.setTimeout(() => finish(), 1600);

    function finish(entry?: HTMLElement): void {
      window.clearTimeout(timer);
      changes.disconnect();
      signal.removeEventListener("abort", cancel);
      document.removeEventListener("transitionend", check, true);
      resolve({ popup, entry });
    }

    function cancel(): void {
      finish();
    }

    function check(): void {
      if (signal.aborted) {
        finish();
        return;
      }
      const owned = ownedMenus();
      const [open] = owned;
      if (popup && (owned.length !== 1 || open !== popup)) {
        finish();
        return;
      }
      if (!popup && owned.length === 1 && open) {
        popup = open;
        popup.setAttribute("data-ytt-feedback-menu", "");
      }
      if (!popup) return;
      const entry = selectedEntry(popup);
      if (entry) finish(entry);
    }

    signal.addEventListener("abort", cancel, { once: true });
    document.addEventListener("transitionend", check, true);
    changes.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "hidden",
        "class",
        "style",
        "aria-hidden",
        "aria-disabled",
        "disabled",
        "inert",
        "data-target-id",
      ],
    });
    check();
  });
}

function waitForFeedbackResult(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(finish, 2400);
    function finish(): void {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

function close(menu: Element): void {
  const visible = openMenus();
  function exclusiveParent(selector: string): Element | null {
    const parent = menu.closest(selector);
    return parent &&
      !visible.some((popup) => popup !== menu && parent.contains(popup))
      ? parent
      : null;
  }

  const sheet = exclusiveParent(`bottom-sheet-container,${legacyMenu}`);
  const button =
    sheet?.querySelector("button.close-button") ??
    sheet?.querySelector("button.ytWebScrimHiddenButton");
  if (button instanceof HTMLButtonElement) {
    button.click();
    return;
  }
  const dropdown = exclusiveParent("tp-yt-iron-dropdown");
  const dismiss = property(dropdown, "close");
  if (typeof dismiss === "function") Reflect.apply(dismiss, dropdown, []);
}

function activeRoute(): boolean {
  return /^(?:\/(?:results|watch)?\/?|\/feed\/(?:subscriptions|trending|explore)\/?)$/.test(
    location.pathname,
  );
}

function sameRoute(route: string, popup?: Element): boolean {
  if (location.href === route) return true;
  if (!mobile) return false;
  const overlays = popup
    ? [popup.matches(legacyMenu) ? "#menu" : "#bottom-sheet"]
    : ["#menu", "#bottom-sheet"];
  return overlays.some((hash) => new URL(hash, route).href === location.href);
}

function measure(item: Item, preview?: HTMLElement) {
  if (item.anchor.closest("[hidden]")) return;
  const surface = preview ?? item.surface;
  if (getComputedStyle(surface).visibility === "hidden") return;
  const image = surface.getBoundingClientRect();
  const size = 32;
  const gap = 4;
  const stack = size * 2 + gap;
  const horizontal = image.height < stack;
  const width = horizontal ? stack : size;
  const height = horizontal ? size : stack;
  if (image.width < width || image.height < height) return;
  const origin = preview ?? item.element;
  const originBox = origin.getBoundingClientRect();
  const rtl = getComputedStyle(origin).direction === "rtl";
  const insetX = Math.min(gap, (image.width - width) / 2);
  const insetY = Math.min(gap, (image.height - height) / 2);
  const left = image.left + insetX;
  const right = image.right - width - insetX;
  const top = image.top + insetY;
  const bottom = image.bottom - height - insetY;
  const native = [
    ...(preview ?? item.anchor).querySelectorAll(
      preview
        ? "ytm-mute-button button,ytm-closed-captioning-button button"
        : `${nativeActions} button,ytd-thumbnail-overlay-toggle-button-renderer`,
    ),
  ]
    .map((button) => button.getBoundingClientRect())
    .filter(
      (box) =>
        box.width &&
        box.height &&
        box.top < image.bottom &&
        box.bottom > image.top,
    );
  for (const x of rtl ? [left, right] : [right, left]) {
    let y = top;
    for (const box of native
      .filter((box) => x < box.right && x + width > box.left)
      .sort((a, b) => a.top - b.top)) {
      if (y + height + gap <= box.top) break;
      if (y < box.bottom + gap) y = box.bottom + gap;
    }
    if (y <= bottom)
      return {
        left: `${x - originBox.left - origin.clientLeft}px`,
        top: `${y - originBox.top - origin.clientTop}px`,
        horizontal,
      };
  }
}

export function feedback(): void {
  GM_addStyle(styles);
  app((root) => {
    const items = new Map<Element, Item>();
    const notices = new WeakMap<HTMLButtonElement, number>();
    const pendingPositions = new Set<Item>();
    let frame: number | undefined;
    const thumbnails =
      typeof ResizeObserver === "function"
        ? new ResizeObserver((entries) => {
            for (const { target } of entries) {
              const card = target.closest(cardSelector);
              const item = card && items.get(card);
              if (item?.surface === target) schedulePosition(item);
            }
          })
        : undefined;
    let operation: Operation | undefined;
    let scope: Element | undefined;
    let hovered: Item | undefined;
    let preview: Preview | undefined;
    const previewObserver = new MutationObserver(() => {
      if (
        preview &&
        (!preview.target.matches(activePreview) ||
          !root.contains(preview.target) ||
          preview.target.closest("[hidden]") ||
          !visible(preview.target))
      )
        detachPreview();
    });

    function positionBatch(): void {
      frame = undefined;
      const batch = [...pendingPositions];
      pendingPositions.clear();
      const positions = batch.map((item) => ({
        panel: item.panel,
        position: measure(
          item,
          preview?.item === item ? preview.target : undefined,
        ),
      }));
      for (const { panel, position } of positions) {
        const hidden = !position;
        if (panel.hidden !== hidden) panel.hidden = hidden;
        if (!position) continue;
        panel.classList.toggle("ytt-feedback-row", position.horizontal);
        if (panel.style.left !== position.left)
          panel.style.left = position.left;
        if (panel.style.top !== position.top) panel.style.top = position.top;
      }
    }

    function schedulePosition(item: Item): void {
      pendingPositions.add(item);
      frame ??= window.requestAnimationFrame(positionBatch);
    }

    function ownsPanel(item: Item): boolean {
      return (
        item.panel.parentElement === item.element ||
        (preview?.item === item && item.panel.parentElement === preview.target)
      );
    }

    function detachPreview(restore = true): void {
      if (!preview) return;
      const { item } = preview;
      preview = undefined;
      previewObserver.disconnect();
      item.panel.classList.remove("ytt-feedback-preview");
      if (restore) {
        item.element.append(item.panel);
        schedulePosition(item);
      }
    }

    function enterPreview(target: HTMLElement, item: Item): void {
      if (preview?.item === item && preview.target === target) return;
      detachPreview();
      preview = { item, target };
      target.append(item.panel);
      item.panel.classList.add("ytt-feedback-preview");
      schedulePosition(item);
      for (
        let parent: Element | null = target;
        parent && root.contains(parent);
        parent = parent.parentElement
      ) {
        previewObserver.observe(parent, {
          childList: true,
          attributes: true,
          attributeFilter: ["class", "hidden", "style"],
        });
        if (parent === root) break;
      }
    }

    function rename(button: HTMLButtonElement, text: string): void {
      button.title = text;
      button.setAttribute("aria-label", text);
    }

    function unavailable(button: HTMLButtonElement, action: Action): void {
      if (!button.isConnected) return;
      window.clearTimeout(notices.get(button));
      rename(button, message("unavailable"));
      button.dataset.unavailable = "";
      notices.set(
        button,
        window.setTimeout(() => {
          rename(button, message(action));
          delete button.dataset.unavailable;
          notices.delete(button);
        }, 1550),
      );
    }

    function cancelOperation(): void {
      operation?.controller.abort();
    }

    function validTarget({ item, trigger, href }: Operation): boolean {
      return (
        items.get(item.element) === item &&
        ownsPanel(item) &&
        Boolean(scope?.contains(item.element)) &&
        !item.element.closest(historyRenderer) &&
        !item.anchor.closest("[hidden]") &&
        visible(item.anchor) &&
        item.element.querySelector(triggerSelector) === trigger &&
        item.element.querySelector(thumbnail) === item.anchor &&
        item.anchor.href === href
      );
    }

    async function run(
      item: Item,
      button: HTMLButtonElement,
      action: Action,
    ): Promise<void> {
      if (operation || !activeRoute()) return;
      const trigger = item.element.querySelector(triggerSelector);
      if (
        !(trigger instanceof HTMLElement) ||
        trigger.closest(disabled) ||
        openMenus().length
      ) {
        unavailable(button, action);
        return;
      }
      const controller = new AbortController();
      const current = {
        item,
        trigger,
        route: location.href,
        href: item.anchor.href,
        hrefAttribute: item.anchor.getAttribute("href"),
        controller,
      };
      if (!validTarget(current)) return;
      operation = current;
      function interrupt(event: Event): void {
        if (
          !event.isTrusted ||
          (event.target instanceof Element &&
            event.target.closest(".ytt-feedback .ytt-action"))
        )
          return;
        cancelOperation();
      }
      for (const type of ["pointerdown", "keydown", "click"])
        document.addEventListener(type, interrupt, {
          capture: true,
          signal: controller.signal,
        });
      let menu: Element | undefined;
      let marker: MenuMarker | undefined;
      function releaseMenu(): void {
        menu?.removeAttribute("data-ytt-feedback-menu");
        menu = undefined;
        marker?.release();
        marker = undefined;
      }
      try {
        const identity = menuIdentity(trigger);
        marker = identity.marker;
        trigger.click();
        const legacy = openedLegacyMenu(trigger, current.route);
        const { signal } = controller;
        const ownership = (menu: Element) =>
          menuOwner(menu, current, identity) ??
          (menu === legacy ? "anchor" : undefined);
        const ownedMenus = () =>
          openMenus().filter((menu) => {
            const owner = ownership(menu);
            return owner === "anchor" || owner === "row";
          });
        function selectedEntry(menu: Element): HTMLElement | undefined {
          const owner = ownership(menu);
          const entry = matchingAction(menu, action);
          if (!entry || owner === "conflict" || !owner) return;
          if (owner === "anchor") return entry;
          const row = entry.closest(nativeRow) ?? entry;
          const token = feedbackToken(property(row, "data"));
          if (
            token
              ? identity.tokens.has(token)
              : identity.marker && row.matches(identity.marker.selector)
          )
            return entry;
        }
        const { popup, entry } = await waitForMenuAction(
          signal,
          ownedMenus,
          selectedEntry,
        );
        menu = popup;
        const canSelect =
          !controller.signal.aborted &&
          sameRoute(current.route, popup) &&
          validTarget(current);
        if (!canSelect) return;
        const owned = popup ? ownedMenus() : [];
        if (popup && (owned.length !== 1 || owned[0] !== popup)) return;
        if (!entry || !popup || selectedEntry(popup) !== entry) {
          if (popup) close(popup);
          unavailable(button, action);
          return;
        }
        entry.click();
        releaseMenu();
        if (signal.aborted || !validTarget(current)) return;
        await waitForFeedbackResult(signal);
        if (
          !signal.aborted &&
          sameRoute(current.route, popup) &&
          validTarget(current)
        )
          unavailable(button, action);
      } finally {
        cancelOperation();
        operation = undefined;
        releaseMenu();
      }
    }

    function remove(item: Item): void {
      if (preview?.item === item) detachPreview(false);
      if (hovered === item) hovered = undefined;
      thumbnails?.unobserve(item.surface);
      pendingPositions.delete(item);
      if (frame !== undefined && !pendingPositions.size) {
        window.cancelAnimationFrame(frame);
        frame = undefined;
      }
      item.panel.remove();
      item.anchor.classList.remove("ytt-feedback-thumbnail");
      item.element.classList.remove("ytt-feedback-card");
      items.delete(item.element);
    }

    function mount(element: Element): void {
      const old = items.get(element);
      const anchor = element.querySelector(thumbnail);
      const surface = anchor?.querySelector(picture) ?? anchor;
      const suitable =
        anchor instanceof HTMLAnchorElement &&
        anchor.closest(cardSelector) === element &&
        Boolean(scope?.contains(element)) &&
        !element.closest(`${ignored},${historyRenderer}`) &&
        !element.querySelector(ignored);
      if (old) {
        if (
          suitable &&
          anchor === old.anchor &&
          surface === old.surface &&
          ownsPanel(old)
        ) {
          schedulePosition(old);
          return;
        }
        remove(old);
      }
      if (!suitable || !surface) return;
      const panel = document.createElement("div");
      panel.className = "ytt-feedback";
      const item = { element, anchor, surface, panel };
      for (const action of ["interest", "channel"] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `ytt-action ytSpecButtonShapeNextHost ytSpecButtonShapeNextIconButton ytSpecButtonShapeNextOverlayDark ${nativeBackground}`;
        rename(button, message(action));
        button.append(svg(icons[action]));
        activation(
          button,
          () =>
            void run(item, button, action).catch(() =>
              unavailable(button, action),
            ),
        );
        panel.append(button);
      }
      items.set(element, item);
      element.classList.add("ytt-feedback-card");
      anchor.classList.add("ytt-feedback-thumbnail");
      element.append(panel);
      thumbnails?.observe(surface);
      schedulePosition(item);
    }

    const observer = new MutationObserver((records) => {
      const pending = operation;
      if (
        pending &&
        !pending.controller.signal.aborted &&
        (!validTarget(pending) ||
          records.some(
            (record) =>
              (record.target === pending.item.anchor &&
                record.attributeName === "href" &&
                record.oldValue !== pending.hrefAttribute) ||
              [...record.removedNodes].some(
                (node) =>
                  node.contains(pending.item.anchor) ||
                  node.contains(pending.trigger),
              ),
          ))
      )
        cancelOperation();
      const updated = new Set<Element>();
      function updateTree(node: Node): void {
        if (!(node instanceof Element) || node.matches(".ytt-feedback")) return;
        if (node.matches(cardSelector)) updated.add(node);
        node
          .querySelectorAll(cardSelector)
          .forEach((card) => updated.add(card));
      }
      for (const record of records) {
        const card =
          record.target instanceof Element && items.get(record.target);
        if (
          record.type === "childList" &&
          card &&
          ownsPanel(card) &&
          [...record.addedNodes, ...record.removedNodes].every(
            (node) => node === card.panel,
          )
        )
          continue;
        record.addedNodes.forEach(updateTree);
        record.removedNodes.forEach(updateTree);
        if (
          record.target instanceof Element &&
          !record.target.closest(".ytt-feedback")
        ) {
          const parent = record.target.closest(cardSelector);
          if (parent) updated.add(parent);
          if (
            record.attributeName === "page-subtype" ||
            record.attributeName === "hidden"
          )
            updateTree(record.target);
        }
      }
      updated.forEach(mount);
    });

    const managers = mobile
      ? undefined
      : new MutationObserver((records) => {
          const addedManager =
            !scope &&
            records.some(({ addedNodes }) =>
              [...addedNodes].some(
                (node) =>
                  node instanceof Element &&
                  (node.matches(desktopFeed) ||
                    node.querySelector(desktopFeed)),
              ),
            );
          if ((scope || addedManager) && bindScope()) scanScope();
        });

    function bindScope(): boolean {
      const active = activeRoute();
      const nextScope = active
        ? mobile
          ? root
          : (root.querySelector(desktopFeed) ?? undefined)
        : undefined;
      const changed = nextScope !== scope;
      if (changed) {
        cancelOperation();
        observer.disconnect();
        for (const item of items.values())
          if (!nextScope?.contains(item.element)) remove(item);
        scope = nextScope;
        if (scope)
          observer.observe(scope, {
            subtree: true,
            attributes: true,
            attributeOldValue: true,
            attributeFilter: ["href", "hidden", "page-subtype"],
            childList: true,
          });
      }
      managers?.disconnect();
      if (active && managers) {
        if (!nextScope)
          managers.observe(root, { childList: true, subtree: true });
        else {
          for (
            let parent = nextScope.parentElement;
            parent && root.contains(parent);
            parent = parent.parentElement
          )
            managers.observe(parent, { childList: true });
        }
      }
      return changed;
    }

    function scanScope(): void {
      scope?.querySelectorAll(cardSelector).forEach(mount);
    }

    function sync(): void {
      if (operation && !sameRoute(operation.route)) cancelOperation();
      if (preview) detachPreview();
      hovered = undefined;
      if (bindScope()) scanScope();
    }

    window.addEventListener("resize", () => items.forEach(schedulePosition), {
      passive: true,
    });
    root.addEventListener("focusin", (event) => {
      const selected =
        event.target instanceof Element
          ? event.target.closest(cardSelector)
          : null;
      const item = selected && items.get(selected);
      if (item) schedulePosition(item);
    });
    root.addEventListener(
      "pointerover",
      (event) => {
        if (!(event.target instanceof Element)) return;
        if (!mobile && event instanceof PointerEvent) {
          const target = event.target.closest(
            `${previewHost} ${activePreview}`,
          );
          if (target instanceof HTMLElement && hovered) {
            const box = hovered.surface.getBoundingClientRect();
            if (
              event.clientX >= box.left &&
              event.clientX < box.right &&
              event.clientY >= box.top &&
              event.clientY < box.bottom
            ) {
              enterPreview(target, hovered);
              return;
            }
          }
          if (preview) detachPreview();
        }
        const selected = event.target.closest(cardSelector);
        const item = selected && items.get(selected);
        if (!mobile)
          hovered =
            item && item.surface.contains(event.target) ? item : undefined;
        if (item) schedulePosition(item);
      },
      { passive: true },
    );
    navigation(sync);
    sync();
  });
}
