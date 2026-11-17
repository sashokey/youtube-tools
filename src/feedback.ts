import { activation, app, mobile, navigation, svg, visible } from "./dom.ts";
import { feedbackLabels, message } from "./language.ts";

const cardSelector = mobile
  ? "yt-lockup-view-model,ytm-video-with-context-renderer,ytm-compact-video-renderer"
  : "yt-lockup-view-model,ytd-video-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer,ytd-rich-item-renderer";
const desktopFeed = "ytd-page-manager,#page-manager";
const mobileTop = "ytm-mobile-topbar-renderer";
const mobileBars = `${mobileTop},ytm-pivot-bar-renderer`;
const thumbnail =
  'a.ytLockupViewModelContentImage,a#thumbnail,a.media-item-thumbnail-container,a[href^="/watch?v="]:has(img)';
const picture = "yt-thumbnail-view-model,ytd-thumbnail";
const nativeActions = "yt-thumbnail-hover-overlay-toggle-actions-view-model";
const legacyActions = "ytd-thumbnail-overlay-toggle-button-renderer";
const hiddenActions =
  ":is(.ytThumbnailHoverOverlayToggleActionsViewModelHidden,.ytThumbnailHoverOverlayToggleActionsViewModelHiddenGated)";
const nativeBackground =
  "ytThumbnailHoverOverlayToggleActionsViewModelOverlayBackground";
const tonalBackground = "ytSpecButtonShapeNextTonal";
const surfaceClasses = [
  nativeBackground,
  tonalBackground,
  "ytSpecButtonShapeNextEnableBackdropFilterExperiment",
  "ytSpecButtonShapeNextEnableLightTouchResponse",
];
const nativeSurface = `button:is(.${nativeBackground},.${tonalBackground})`;
const previewHost = "#video-preview";
const previewTag = "ytd-video-preview";
const previewActive = "ytdVideoPreviewActive";
const activePreview = `${previewTag}.${previewActive}`;
const loaderActive = "ytdVideoPreviewLoaderActive";
const loaderContainer = ".ytdVideoPreviewLoaderVideoPreviewContainer";
const previewContainer = `${previewTag},ytd-video-preview-loader,${loaderContainer}`;
const previewControls = "ytm-mute-button,ytm-closed-captioning-button";
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
const actions = ["interest", "channel"] as const;
const menuIcons: Record<Action, string> = { interest: "HIDE", channel: "REMOVE" };

type Item = {
  element: Element;
  anchor: HTMLAnchorElement;
  surface: Element;
  panel: HTMLDivElement;
  clippers: Set<Element>;
  actionCount: number;
  nativeSurface?: { container: Element; observer: MutationObserver };
};
type Hovered = { item: Item; href: string; gesture: symbol };
type Preview = Hovered & { target: HTMLElement };
type Ownership = Pick<Hovered, "href" | "gesture"> & { ended: boolean };
type HorizontalBounds = {
  left: number;
  right: number;
  clippers: readonly Element[];
};
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
  .ytt-feedback-card:has(.ytt-feedback-thumbnail:hover):not(:has(${nativeActions}${hiddenActions}))>.ytt-feedback,.ytt-feedback-card:has(${nativeActions}:hover)>.ytt-feedback,.ytt-feedback-card:focus-within>.ytt-feedback,.ytt-feedback:hover,.ytt-feedback-preview{opacity:1;visibility:visible}
  .ytt-feedback-card:has(>.ytt-feedback:hover,${nativeActions}:hover) ${nativeActions}${hiddenActions}{opacity:1;visibility:visible}
  .ytt-feedback-card:has(>.ytt-feedback:hover) ${legacyActions}:not([hidden]){opacity:1;visibility:visible}
  ${mobile ? ".ytt-feedback{opacity:1;visibility:visible}" : "@media(hover:none),(pointer:coarse){.ytt-feedback{opacity:1;visibility:visible}}"}
  button.ytt-action{position:relative;box-sizing:border-box;display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:50%;color:var(--yt-spec-static-white,#fff);cursor:pointer;pointer-events:auto}
  button.ytt-action[hidden]{display:none!important}
  :where(button.ytt-action){background-color:rgba(0,0,0,.3)}
  :where(button.ytt-action:hover,button.ytt-action:active){background-color:rgba(40,40,40,.4)}
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

function rowCommand(data: unknown): unknown {
  return path(
    data,
    "rendererContext",
    "commandContext",
    "onTap",
    "innertubeCommand",
  );
}

function feedbackToken(data: unknown): string | undefined {
  const token = path(rowCommand(data), "feedbackEndpoint", "feedbackToken");
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

function inlineMenuItems(trigger: Element | null): unknown[] | undefined {
  const items = path(
    trigger?.closest("button-view-model"),
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
  return Array.isArray(items) ? items : undefined;
}

function otherMenuCommand(command: object): boolean {
  const url = path(command, "commandMetadata", "webCommandMetadata", "apiUrl");
  const api =
    typeof url === "string"
      ? /^\/youtubei\/v\d+\/([a-z_]+)(?:\/|$)/.exec(url)?.[1]
      : undefined;
  if (api) {
    if (api === "feedback") return false;
    try {
      const endpoints = Object.keys(command).filter((name) =>
        name.endsWith("Endpoint"),
      );
      const [name] = endpoints;
      if (endpoints.length !== 1 || !name) return false;
      const endpoint = property(command, name);
      return (
        endpoint !== null &&
        typeof endpoint === "object" &&
        !Array.isArray(endpoint)
      );
    } catch {
      return false;
    }
  }
  const signal = property(command, "signalServiceEndpoint");
  const clientActions = property(signal, "actions");
  const strategy = path(command, "showSheetCommand", "panelLoadingStrategy");
  return (
    (property(signal, "signal") === "CLIENT_SIGNAL" &&
      Array.isArray(clientActions) &&
      clientActions.length > 0) ||
    Boolean(
      strategy && typeof strategy === "object" && !Array.isArray(strategy),
    )
  );
}

function availableActions(trigger: Element | null): Set<Action> | undefined {
  const items = inlineMenuItems(trigger);
  if (!items?.length) return;
  const available = new Set<Action>();
  for (const item of items) {
    const download = property(item, "downloadListItemViewModel");
    if (download && typeof download === "object" && !Array.isArray(download))
      continue;
    const row = property(item, "listItemViewModel");
    const command = rowCommand(row);
    if (!command || typeof command !== "object") return;
    const image = path(
      row,
      "leadingImage",
      "sources",
      "0",
      "clientResource",
      "imageName",
    );
    const byIcon = actions.find((action) => image === menuIcons[action]);
    if (!property(command, "feedbackEndpoint")) {
      if (!byIcon && otherMenuCommand(command)) continue;
      return;
    }
    if (!feedbackToken(row)) return;
    const title = path(row, "title", "content");
    const label = typeof title === "string" ? normalize(title) : undefined;
    const action =
      byIcon ??
      actions.find((action) =>
        feedbackLabels(action).some((text) => normalize(text) === label),
      );
    if (!action) return;
    available.add(action);
  }
  return available;
}

function menuIdentity(trigger: HTMLElement): MenuIdentity {
  const tokens = new Set<string>();
  const candidates: object[] = [];
  for (const item of inlineMenuItems(trigger) ?? []) {
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

function clipBounds(
  element: Element | null,
  viewport: number,
  cache: Map<Element, HorizontalBounds>,
): HorizontalBounds {
  if (
    !element ||
    element === document.body ||
    element === document.documentElement
  )
    return { left: 0, right: viewport, clippers: [] };
  const cached = cache.get(element);
  if (cached) return cached;
  const outer = clipBounds(element.parentElement, viewport, cache);
  let bounds = outer;
  if (
    getComputedStyle(element).overflowX !== "visible" &&
    element.getClientRects().length
  ) {
    const left = element.getBoundingClientRect().left + element.clientLeft;
    bounds = {
      left: Math.max(outer.left, left),
      right: Math.min(outer.right, left + element.clientWidth),
      clippers: [...outer.clippers, element],
    };
  }
  cache.set(element, bounds);
  return bounds;
}

function measure(
  item: Item,
  viewport: number,
  origin: Element,
  clips: Map<Element, HorizontalBounds>,
  clippers: Set<Element>,
  preview?: HTMLElement,
) {
  const surface = preview ?? item.surface;
  const imageClip = clipBounds(surface.parentElement, viewport, clips);
  const panelClip = clipBounds(origin, viewport, clips);
  for (const element of imageClip.clippers) clippers.add(element);
  for (const element of panelClip.clippers) clippers.add(element);
  if (!item.actionCount || item.anchor.closest("[hidden]")) return;
  if (getComputedStyle(surface).visibility === "hidden") return;
  const image = surface.getBoundingClientRect();
  const size = 32;
  const gap = 4;
  const stack = size * item.actionCount + gap * (item.actionCount - 1);
  const horizontal = image.height < stack;
  const width = horizontal ? stack : size;
  const height = horizontal ? size : stack;
  const visibleLeft = Math.max(image.left, imageClip.left, panelClip.left);
  const visibleRight = Math.min(image.right, imageClip.right, panelClip.right);
  const visibleWidth = visibleRight - visibleLeft;
  if (visibleWidth < width || image.height < height) return;
  const originBox = origin.getBoundingClientRect();
  const rtl = getComputedStyle(origin).direction === "rtl";
  const insetX = Math.min(gap, (visibleWidth - width) / 2);
  const insetY = Math.min(gap, (image.height - height) / 2);
  const left = visibleLeft + insetX;
  const right = visibleRight - width - insetX;
  const top = image.top + insetY;
  const bottom = image.bottom - height - insetY;
  const source = preview ?? item.anchor;
  const surfaceButton = source.querySelector(`${nativeActions} ${nativeSurface}`);
  const surfaceContainer =
    surfaceButton?.closest(nativeActions) ?? source.querySelector(nativeActions);
  const classes = surfaceButton
    ? surfaceClasses.filter((name) => surfaceButton.classList.contains(name))
    : [tonalBackground];
  const native = [
    ...(preview ?? item.anchor).querySelectorAll(
      preview
        ? `:is(${previewControls}) button`
        : `${nativeActions} button,${legacyActions}`,
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
        classes,
        surfaceContainer,
      };
  }
}

function positionPanel(
  panel: HTMLDivElement,
  position: ReturnType<typeof measure>,
): void {
  const hidden = !position;
  if (panel.hidden !== hidden) panel.hidden = hidden;
  if (!position) return;
  panel.classList.toggle("ytt-feedback-row", position.horizontal);
  if (panel.style.left !== position.left) panel.style.left = position.left;
  if (panel.style.top !== position.top) panel.style.top = position.top;
  for (const button of panel.children)
    for (const name of surfaceClasses)
      button.classList.toggle(name, position.classes.includes(name));
}

function movePanel(panel: HTMLDivElement, parent: Element): void {
  if (
    typeof parent.moveBefore === "function" &&
    panel.isConnected === parent.isConnected
  ) {
    parent.moveBefore(panel, null);
    return;
  }
  const active = document.activeElement;
  parent.append(panel);
  if (active instanceof HTMLElement && panel.contains(active))
    active.focus({ preventScroll: true });
}

export function feedback(): void {
  GM_addStyle(styles);
  app((root) => {
    const items = new Map<Element, Item>();
    const notices = new WeakMap<HTMLButtonElement, number>();
    const pendingPositions = new Set<Item>();
    const scrollPositions = new WeakMap<Element, number>();
    const changedScroll = new Set<Element>();
    const previewOwners = new WeakMap<HTMLElement, Ownership>();
    const visibleMobile = new Set<Item>();
    const observedMobileBars = new Set<Element>();
    let mobileFrame: number | undefined;
    const mobileBarChanges = mobile
      ? new MutationObserver(() => scheduleMobileClip())
      : undefined;
    const mobileThumbnails =
      mobile && typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            for (const { target, isIntersecting } of entries) {
              const card = target.closest(cardSelector);
              const item = card && items.get(card);
              if (item?.surface !== target) continue;
              if (isIntersecting) visibleMobile.add(item);
              else visibleMobile.delete(item);
            }
            scheduleMobileClip();
          })
        : undefined;
    const clippedItems = new Map<Element, Set<Item>>();
    const clippingSizes =
      typeof ResizeObserver === "function"
        ? new ResizeObserver((entries) => {
            for (const { target } of entries)
              clippedItems.get(target)?.forEach(schedulePosition);
          })
        : undefined;
    let frame: number | undefined;
    const thumbnails =
      typeof ResizeObserver === "function"
        ? new ResizeObserver((entries) => {
            for (const { target, contentRect } of entries) {
              if (observedMobileBars.has(target)) {
                scheduleMobileClip();
                continue;
              }
              if (preview?.target === target) {
                schedulePosition(preview.item);
                continue;
              }
              const card = target.closest(cardSelector);
              const item = card && items.get(card);
              if (item?.surface !== target) continue;
              if (
                hovered?.item === item &&
                (!contentRect.width || !contentRect.height)
              )
                setHovered();
              schedulePosition(item);
            }
          })
        : undefined;
    let operation: Operation | undefined;
    let scope: Element | undefined;
    let route = location.href;
    let hovered: Hovered | undefined;
    let preview: Preview | undefined;
    let host: Element | null = null;
    const previewObserver = mobile
      ? undefined
      : new MutationObserver((records) => {
          let affected = false;
          for (const record of records) {
            const { target, addedNodes, removedNodes } = record;
            if (!(target instanceof Element)) continue;
            if (target === root)
              affected ||= [...addedNodes, ...removedNodes].some(
                (node) => node instanceof Element && node.matches(previewHost),
              );
            else if (target === host || target.closest(previewControls))
              affected = true;
            else if (target.matches(previewContainer)) {
              resetPreviewOwner(record, target);
              affected ||= !(
                target === preview?.target &&
                addedNodes.length === 1 &&
                addedNodes[0] === preview.item.panel &&
                !removedNodes.length
              );
            }
          }
          if (affected) syncPreview();
        });

    function resetPreviewOwner(record: MutationRecord, target: Element): void {
      if (record.attributeName === "class") {
        const old = record.oldValue?.split(/\s+/) ?? [];
        if (
          target instanceof HTMLElement &&
          target.matches(previewTag) &&
          old.includes(previewActive) !==
            target.classList.contains(previewActive)
        )
          endOwnership(target);
        if (
          !target.matches(loaderContainer) ||
          old.includes(loaderActive) === target.classList.contains(loaderActive)
        )
          return;
      } else if (record.attributeName !== "hidden") {
        return;
      }
      if (target instanceof HTMLElement && target.matches(previewTag))
        endOwnership(target);
      for (const child of target.querySelectorAll<HTMLElement>(previewTag))
        endOwnership(child);
    }

    function endOwnership(target: HTMLElement): void {
      const owner = previewOwners.get(target);
      if (!owner || owner.ended) return;
      owner.ended = true;
      if (preview?.target === target) detachPreview();
    }

    function watchClipping(item: Item, next: Set<Element>): void {
      if (!clippingSizes) return;
      for (const element of item.clippers) {
        if (next.has(element)) continue;
        const entries = clippedItems.get(element);
        entries?.delete(item);
        if (!entries?.size) {
          clippingSizes.unobserve(element);
          clippedItems.delete(element);
        }
      }
      for (const element of next) {
        if (item.clippers.has(element)) continue;
        const entries = clippedItems.get(element);
        if (entries) entries.add(item);
        else {
          clippedItems.set(element, new Set([item]));
          clippingSizes.observe(element);
        }
      }
      item.clippers = next;
    }

    function watchMobileBars(next: readonly Element[]): void {
      if (
        next.length === observedMobileBars.size &&
        next.every((bar) => observedMobileBars.has(bar))
      )
        return;
      mobileBarChanges?.disconnect();
      for (const bar of observedMobileBars)
        if (!next.includes(bar)) thumbnails?.unobserve(bar);
      for (const bar of next) {
        if (!observedMobileBars.has(bar)) thumbnails?.observe(bar);
        mobileBarChanges?.observe(bar, {
          attributes: true,
          attributeFilter: ["class", "hidden", "style"],
        });
      }
      observedMobileBars.clear();
      next.forEach((bar) => observedMobileBars.add(bar));
    }

    function clipMobileControls(): void {
      mobileFrame = undefined;
      const nativeBars = [...root.querySelectorAll(mobileBars)];
      watchMobileBars(nativeBars);
      const bars = nativeBars
        .filter((bar) => {
          const { visibility, opacity } = getComputedStyle(bar);
          return visibility === "visible" && opacity !== "0";
        })
        .map((bar) => ({
          upper: bar.matches(mobileTop),
          box: bar.getBoundingClientRect(),
        }))
        .filter(({ box }) => box.width > 0 && box.height > 0);
      const masks = [...visibleMobile].map(({ panel, anchor }) => {
        const bounds = panel.getBoundingClientRect();
        let top = 0;
        let bottom = 0;
        for (const { upper, box } of bars) {
          if (
            bounds.right <= box.left ||
            bounds.left >= box.right ||
            bounds.bottom <= box.top ||
            bounds.top >= box.bottom
          )
            continue;
          if (upper) top = Math.max(top, box.bottom - bounds.top);
          else bottom = Math.max(bottom, bounds.bottom - box.top);
        }
        top = Math.min(top, bounds.height);
        bottom = Math.min(bottom, bounds.height - top);
        const clipped = top > 0 || bottom > 0;
        const buttons = [...panel.children]
          .filter((child) => child instanceof HTMLButtonElement)
          .map((button) => {
            const box = clipped ? button.getBoundingClientRect() : undefined;
            const inert = Boolean(
              box &&
              (box.bottom <= bounds.top + top ||
                box.top >= bounds.bottom - bottom),
            );
            return { button, inert };
          });
        return {
          panel,
          anchor,
          buttons,
          clip: clipped ? `inset(${top}px 0 ${bottom}px)` : "",
        };
      });
      for (const { panel, anchor, buttons, clip } of masks) {
        if (panel.style.clipPath !== clip) panel.style.clipPath = clip;
        for (const { button, inert } of buttons) {
          if (button.inert === inert) continue;
          if (inert && button === document.activeElement)
            anchor.focus({ preventScroll: true });
          button.inert = inert;
        }
      }
      if (
        typeof CSSTransition === "function" &&
        nativeBars.some((bar) =>
          bar
            .getAnimations()
            .some(
              (animation) =>
                animation instanceof CSSTransition &&
                animation.playState === "running",
            ),
        )
      )
        scheduleMobileClip();
    }

    function scheduleMobileClip(): void {
      if (visibleMobile.size)
        mobileFrame ??= window.requestAnimationFrame(clipMobileControls);
    }

    function setPosition(item: Item, position: ReturnType<typeof measure>): void {
      const container = position?.surfaceContainer ?? undefined;
      if (item.nativeSurface?.container !== container) {
        item.nativeSurface?.observer.disconnect();
        if (container) {
          const observer = new MutationObserver(() => schedulePosition(item));
          observer.observe(container, {
            attributes: true,
            attributeFilter: ["class"],
            subtree: true,
          });
          item.nativeSurface = { container, observer };
        } else {
          delete item.nativeSurface;
        }
      }
      positionPanel(item.panel, position);
    }

    function positionBatch(): void {
      frame = undefined;
      for (const scroller of changedScroll) {
        if (!scope) break;
        const area = scroller.contains(scope) ? scope : scroller;
        if (!scope.contains(area)) continue;
        for (const card of area.querySelectorAll(".ytt-feedback-card")) {
          const item = items.get(card);
          if (item) pendingPositions.add(item);
        }
      }
      changedScroll.clear();
      const batch = [...pendingPositions];
      pendingPositions.clear();
      const viewport = document.documentElement.clientWidth;
      const clips = new Map<Element, HorizontalBounds>();
      const positions = batch.map((item) => {
        const target = preview?.item === item ? preview.target : undefined;
        const origin =
          target && item.panel.parentElement === target ? target : item.element;
        const clippers = new Set<Element>();
        return {
          item,
          clippers,
          position: measure(item, viewport, origin, clips, clippers, target),
        };
      });
      for (const { item, clippers, position } of positions) {
        watchClipping(item, clippers);
        setPosition(item, position);
      }
      scheduleMobileClip();
    }

    function schedulePosition(item: Item): void {
      pendingPositions.add(item);
      frame ??= window.requestAnimationFrame(positionBatch);
    }

    function ownsPanel(item: Item): boolean {
      const parent = item.panel.parentElement;
      if (preview?.item !== item) return parent === item.element;
      return (
        preview.href === item.anchor.href &&
        (parent === item.element || parent === preview.target)
      );
    }

    function detachPreview(): void {
      if (!preview) return;
      const { item, target } = preview;
      preview = undefined;
      thumbnails?.unobserve(target);
      movePanel(item.panel, item.element);
      item.panel.classList.remove("ytt-feedback-preview");
      schedulePosition(item);
    }

    function watchPreviewHost(): void {
      previewObserver?.disconnect();
      host = hovered ? root.querySelector(previewHost) : null;
      if (!hovered) return;
      previewObserver?.observe(root, { childList: true });
      if (host)
        previewObserver?.observe(host, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeOldValue: true,
          attributeFilter: ["class", "hidden", "style"],
        });
    }

    function setHovered(item?: Item): void {
      if (hovered?.item === item && hovered?.href === item?.anchor.href) return;
      hovered = item && { item, href: item.anchor.href, gesture: Symbol() };
      detachPreview();
      watchPreviewHost();
    }

    function syncPreview(fromTab = false): void {
      if (!hovered) return;
      const { item, href, gesture } = hovered;
      if (href !== item.anchor.href || !visible(item.anchor)) {
        setHovered();
        return;
      }
      if (root.querySelector(previewHost) !== host) watchPreviewHost();
      const target = host?.querySelector(activePreview);
      if (!(target instanceof HTMLElement) || target.closest("[hidden]")) {
        detachPreview();
        return;
      }
      if (preview?.target !== target) {
        detachPreview();
        const owner = previewOwners.get(target);
        if (
          owner &&
          (owner.ended ? owner.gesture === gesture : owner.href !== href)
        )
          return;
        const image = item.surface.getBoundingClientRect();
        const box = target.getBoundingClientRect();
        const x = image.left + image.width / 2;
        const y = image.top + image.height / 2;
        if (x < box.left || x >= box.right || y < box.top || y >= box.bottom)
          return;
        preview = { item, target, href, gesture };
        previewOwners.set(target, { href, gesture, ended: false });
        thumbnails?.observe(target);
      }
      syncActions(item);
      const focused = document.activeElement;
      const keepCardOrder =
        item.element.contains(focused) ||
        (item.panel.contains(focused) &&
          (fromTab || Boolean(focused?.matches(":focus-visible"))));
      const destination = keepCardOrder ? item.element : target;
      if (
        item.panel.parentElement !== destination ||
        !item.panel.classList.contains("ytt-feedback-preview")
      ) {
        const clippers = new Set<Element>();
        const position = measure(
          item,
          document.documentElement.clientWidth,
          destination,
          new Map(),
          clippers,
          target,
        );
        watchClipping(item, clippers);
        setPosition(item, position);
        item.panel.classList.add("ytt-feedback-preview");
        if (item.panel.parentElement !== destination)
          movePanel(item.panel, destination);
      } else {
        schedulePosition(item);
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
      refreshActions(item);
      if (button.hidden) return;
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
        refreshActions(item);
        const owned = popup ? ownedMenus() : [];
        if (popup && (owned.length !== 1 || owned[0] !== popup)) return;
        if (button.hidden || !entry || !popup || selectedEntry(popup) !== entry) {
          if (popup) close(popup);
          if (!button.hidden) unavailable(button, action);
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
      if (hovered?.item === item) setHovered();
      item.nativeSurface?.observer.disconnect();
      thumbnails?.unobserve(item.surface);
      watchClipping(item, new Set());
      mobileThumbnails?.unobserve(item.surface);
      visibleMobile.delete(item);
      if (!visibleMobile.size && mobileFrame !== undefined) {
        window.cancelAnimationFrame(mobileFrame);
        mobileFrame = undefined;
      }
      pendingPositions.delete(item);
      if (
        frame !== undefined &&
        !pendingPositions.size &&
        !changedScroll.size
      ) {
        window.cancelAnimationFrame(frame);
        frame = undefined;
      }
      item.panel.remove();
      item.anchor.classList.remove("ytt-feedback-thumbnail");
      item.element.classList.remove("ytt-feedback-card");
      items.delete(item.element);
    }

    function syncActions(item: Item): void {
      const available = availableActions(
        item.element.querySelector(triggerSelector),
      );
      item.actionCount = available?.size ?? actions.length;
      const focused = document.activeElement;
      let departing: HTMLButtonElement | undefined;
      for (const [index, action] of actions.entries()) {
        const button = item.panel.children.item(index);
        const hidden = available !== undefined && !available.has(action);
        if (!(button instanceof HTMLButtonElement) || button.hidden === hidden)
          continue;
        if (hidden && button === focused) departing = button;
        else button.hidden = hidden;
      }
      if (departing) {
        const target = [
          ...item.panel.querySelectorAll<HTMLButtonElement>(
            "button:not([hidden])",
          ),
        ].find((button) => button !== departing);
        target?.focus({ preventScroll: true });
        if (!target || document.activeElement !== target)
          item.anchor.focus({ preventScroll: true });
        departing.hidden = true;
      }
    }

    function refreshActions(item: Item): void {
      syncActions(item);
      schedulePosition(item);
    }

    function mount(element: Element): void {
      const old = items.get(element);
      const anchor = element.querySelector(thumbnail);
      const surface =
        anchor?.querySelector(picture) ??
        (anchor?.closest("ytd-thumbnail")
          ? anchor.querySelector("img")
          : null) ??
        anchor;
      const suitable =
        anchor instanceof HTMLAnchorElement &&
        anchor.closest(cardSelector) === element &&
        Boolean(scope?.contains(element)) &&
        !element.closest(`${ignored},${historyRenderer}`) &&
        !element.querySelector(ignored);
      if (old) {
        if (hovered?.item === old && hovered.href !== old.anchor.href)
          setHovered();
        if (
          suitable &&
          anchor === old.anchor &&
          surface === old.surface &&
          ownsPanel(old)
        ) {
          refreshActions(old);
          return;
        }
        remove(old);
      }
      if (!suitable || !surface) return;
      const panel = document.createElement("div");
      panel.className = "ytt-feedback";
      const item: Item = {
        element,
        anchor,
        surface,
        panel,
        clippers: new Set(),
        actionCount: actions.length,
      };
      for (const action of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `ytt-action ytSpecButtonShapeNextHost ytSpecButtonShapeNextIconButton ytSpecButtonShapeNextOverlayDark ${tonalBackground}`;
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
      syncActions(item);
      items.set(element, item);
      element.classList.add("ytt-feedback-card");
      anchor.classList.add("ytt-feedback-thumbnail");
      element.append(panel);
      thumbnails?.observe(surface);
      mobileThumbnails?.observe(surface);
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
        if (
          mobile &&
          record.type === "childList" &&
          [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches(mobileBars) ||
                (record.target === root && node.querySelector(mobileBars))),
          )
        )
          if (visibleMobile.size) scheduleMobileClip();
          else watchMobileBars([]);
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
        if (mobile && !nextScope) watchMobileBars([]);
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
      if (location.href !== route) {
        route = location.href;
        setHovered();
      }
      if (bindScope()) scanScope();
    }

    window.addEventListener("resize", () => items.forEach(schedulePosition), {
      passive: true,
    });
    document.addEventListener(
      "scroll",
      (event) => {
        const scroller =
          event.target === document ? document.scrollingElement : event.target;
        if (
          !scope ||
          !(scroller instanceof Element) ||
          !(scope.contains(scroller) || scroller.contains(scope))
        )
          return;
        scheduleMobileClip();
        const left = scroller.scrollLeft;
        if (left === (scrollPositions.get(scroller) ?? 0)) return;
        scrollPositions.set(scroller, left);
        changedScroll.add(scroller);
        frame ??= window.requestAnimationFrame(positionBatch);
      },
      { capture: true, passive: true },
    );
    if (mobile)
      for (const type of ["transitionrun", "transitionend", "transitioncancel"])
        root.addEventListener(type, (event) => {
          if (
            event.target instanceof Element &&
            event.target.matches(mobileBars)
          )
            scheduleMobileClip();
        });
    root.addEventListener("focusin", (event) => {
      if (preview) syncPreview();
      const selected =
        event.target instanceof Element
          ? event.target.closest(cardSelector)
          : null;
      const item = selected && items.get(selected);
      if (item) refreshActions(item);
    });
    if (!mobile)
      root.addEventListener(
        "keydown",
        (event) => {
          if (
            event instanceof KeyboardEvent &&
            event.key === "Tab" &&
            preview?.item.panel.contains(document.activeElement)
          )
            syncPreview(true);
        },
        true,
      );
    root.addEventListener(
      "pointerover",
      (event) => {
        if (!(event.target instanceof Element)) return;
        if (
          !mobile &&
          event.target.closest(`${previewHost} ${activePreview}`)
        ) {
          syncPreview();
          return;
        }
        const selected = event.target.closest(cardSelector);
        const item = selected && items.get(selected);
        if (!mobile)
          setHovered(
            item &&
              (item.anchor.contains(event.target) ||
                item.panel.contains(event.target))
              ? item
              : undefined,
          );
        if (item) refreshActions(item);
      },
      { capture: true, passive: true },
    );
    if (!mobile) root.addEventListener("pointerleave", () => setHovered());
    navigation(sync);
    sync();
  });
}
