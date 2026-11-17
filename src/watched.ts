import { app, mobile, navigation } from "./dom.ts";
import { enabled, listen } from "./state.ts";

const browse = mobile ? "ytm-browse" : "ytd-browse";
const cards = mobile
  ? "yt-lockup-view-model,ytm-rich-item-renderer,ytm-video-with-context-renderer,ytm-compact-video-renderer,ytm-video-card-renderer"
  : "yt-lockup-view-model,ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer,ytd-reel-item-renderer";
const panels =
  "ytm-playlist-panel-renderer,ytd-playlist-panel-renderer,ytm-playlist-video-list-renderer,ytd-playlist-video-list-renderer";
const collections =
  "yt-collection-thumbnail-view-model,ytd-playlist-thumbnail,ytd-radio-renderer,ytm-radio-renderer";
const progress =
  ".ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment,ytd-thumbnail-overlay-resume-playback-renderer #progress,.ytwThumbnailOverlayResumePlaybackRendererThumbnailOverlayResumePlaybackProgress";
const progressAttribute = "data-ytt-progress";
const progressCandidates = `${progress},[${progressAttribute}]`;
const interacting = mobile
  ? ":focus-within,:active"
  : ":hover,:focus-within,:active";

function scope(): string | undefined {
  const path = location.pathname;
  const type =
    path === "/"
      ? "home"
      : /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)(?:\/|$)/.test(path)
        ? "channels"
        : undefined;
  return type
    ? mobile
      ? browse
      : `${browse}[page-subtype="${type}"]`
    : undefined;
}

function mark(node: Element): void {
  const watched =
    node instanceof HTMLElement &&
    node.matches(progress) &&
    Number.parseFloat(node.style.width) > 0;
  node.toggleAttribute(progressAttribute, watched);
}

function scan(node: Element): void {
  if (node.matches(progressCandidates)) mark(node);
  node.querySelectorAll(progressCandidates).forEach(mark);
}

export function watched(): void {
  GM_addStyle(
    `[data-ytt-filter]:not([hidden]) :is(${cards}):not(:is(${panels},${collections}) *,:has(${collections})):not(${interacting}):has(:is(${progress})[${progressAttribute}]){display:none!important}`,
  );
  app((root) => {
    const active = new Set<Element>();
    let observingViews = false;
    const changes = new MutationObserver((records) => {
      for (const { type, target, addedNodes } of records) {
        if (
          type === "attributes" &&
          target instanceof Element &&
          target.matches(progressCandidates)
        )
          mark(target);
        for (const inserted of addedNodes)
          if (inserted instanceof Element) scan(inserted);
      }
    });

    function sync(): void {
      const view = enabled("showWatched") ? undefined : scope();
      if (Boolean(view) !== observingViews) {
        observingViews = Boolean(view);
        if (observingViews) {
          views.observe(root, {
            subtree: true,
            childList: true,
            attributeFilter: ["hidden", "page-subtype"],
          });
        } else {
          views.disconnect();
        }
      }
      const found = new Set(view ? root.querySelectorAll(view) : []);
      if (
        found.size === active.size &&
        [...found].every((node) => active.has(node))
      )
        return;
      changes.disconnect();
      for (const node of active) node.removeAttribute("data-ytt-filter");
      active.clear();
      for (const node of found) {
        scan(node);
        node.setAttribute("data-ytt-filter", "");
        changes.observe(node, {
          subtree: true,
          childList: true,
          attributeFilter: ["style", "class", "id"],
        });
        active.add(node);
      }
    }

    const views = new MutationObserver((records) => {
      if (
        [...active].some((node) => !node.isConnected) ||
        records.some(
          (record) =>
            (record.type === "attributes" &&
              record.target instanceof Element &&
              record.target.matches(browse)) ||
            [...record.addedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches(browse) || node.querySelector(browse)),
            ),
        )
      )
        sync();
    });
    navigation(sync);
    listen("showWatched", sync);
    sync();
  });
}
