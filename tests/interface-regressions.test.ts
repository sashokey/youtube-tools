import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import type { Browser, BrowserContextOptions, Page } from "playwright";
import { appTag, candidate, freshPage, urlFor } from "./harness.ts";
import type { Host } from "./harness.ts";

let browser: Browser;
before(async () => {
  browser = await chromium.launch({
    args: ["--disable-extensions", "--mute-audio"],
  });
});
after(async () => {
  await browser?.close();
});

const desktop = "www.youtube.com";
const mobile = "m.youtube.com";
const hideNative = "ytThumbnailHoverOverlayToggleActionsViewModelHidden";
const nativeActions = `<yt-thumbnail-hover-overlay-toggle-actions-view-model class="${hideNative}">
  <button type="button" class="ytThumbnailHoverOverlayToggleActionsViewModelOverlayBackground">Watch later</button>
  <button type="button" class="ytThumbnailHoverOverlayToggleActionsViewModelOverlayBackground">Add to queue</button>
</yt-thumbnail-hover-overlay-toggle-actions-view-model>`;

function card(content = "", id = "video"): string {
  return `<yt-lockup-view-model id="${id}">
    <a class="ytLockupViewModelContentImage" href="/watch?v=abcdefghijk">
      <yt-thumbnail-view-model><img alt="Video">${content}</yt-thumbnail-view-model>
    </a>
    <div class="ytLockupMetadataViewModelMenuButton"><button type="button">More</button></div>
  </yt-lockup-view-model>`;
}

const cardStyles = `
  ytd-app,ytm-app,ytd-page-manager,ytm-page-manager,yt-lockup-view-model,yt-thumbnail-view-model {display:block}
  body {margin:0;min-height:2500px}
  yt-lockup-view-model {width: min(360px, 100vw);margin-block:100px 40px}
  .ytLockupViewModelContentImage {display:block;width: min(227px, 100%);height:121px}
  #video:has(yt-thumbnail-hover-overlay-toggle-actions-view-model) > a,
  ytd-app:has(ytd-video-preview-loader) #video > a {height:210px}
  yt-thumbnail-view-model {position:relative;width:calc(100% - 12px);height:100%;background:#777}
  yt-thumbnail-hover-overlay-toggle-actions-view-model {display:flex;position:absolute;inset:0;flex-direction:column;align-items:flex-end;gap:4px;padding:4px;pointer-events:none}
  yt-thumbnail-hover-overlay-toggle-actions-view-model button {width:32px;height:32px;border:0;border-radius:50%;color:white;pointer-events:auto}
  .ytThumbnailHoverOverlayToggleActionsViewModelHidden {visibility:hidden}
  .ytThumbnailHoverOverlayToggleActionsViewModelOverlayBackground {background-color:rgba(0,0,0,.6)}
  .ytThumbnailHoverOverlayToggleActionsViewModelOverlayBackground:hover {background-color:rgba(40,40,40,.6)}
  .ytThumbnailHoverOverlayToggleActionsViewModelOverlayBackground:active {background-color:rgba(60,60,60,.6)}
`;

type Layout = {
  host?: Host;
  path?: string;
  css?: string;
  direction?: "ltr" | "rtl";
  options?: BrowserContextOptions;
  outsideFeed?: string;
  beforeCandidate?: string;
};

async function fixture(
  contents: string,
  run: (page: Page) => Promise<void>,
  {
    host = desktop,
    path = "/",
    css = "",
    direction = "ltr",
    options,
    outsideFeed = "",
    beforeCandidate,
  }: Layout = {},
): Promise<void> {
  const app = appTag(host);
  const manager = host === mobile ? "ytm-page-manager" : "ytd-page-manager";
  await freshPage(
    browser,
    host,
    async (page, context) => {
      context.setDefaultTimeout(3500);
      if (beforeCandidate)
        await context.addInitScript({ content: beforeCandidate });
      await candidate(context);
      await context.route(/^https:\/\/(?:www|m)\.youtube\.com\//, (route) =>
        route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<!doctype html><html lang="en" dir="${direction}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${cardStyles}${css}</style></head>
          <body><${app}><${manager}>${contents}</${manager}>${outsideFeed}</${app}></body></html>`,
        }),
      );
      await page.goto(urlFor(host, path).href);
      await run(page);
    },
    options,
  );
}

function center(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function actionsOnFirstFrame(page: Page): Promise<[boolean, boolean]> {
  return page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => {
          const shown = (selector: string): boolean => {
            const element = document.querySelector(selector);
            if (!element?.getClientRects().length) return false;
            const css = getComputedStyle(element);
            return css.visibility === "visible" && css.opacity !== "0";
          };
          resolve([
            shown("yt-thumbnail-hover-overlay-toggle-actions-view-model"),
            shown(".ytt-feedback .ytt-action"),
          ]);
        }),
      ),
  );
}

for (const direction of ["ltr", "rtl"] as const) {
  void test(`related feedback stays inside the image with a wider link in ${direction}`, () =>
    fixture(
      `<aside id="related">${card()}</aside>`,
      async (page) => {
        await page.locator("#video a").focus();
        const controls = page.locator(".ytt-feedback");
        await controls.waitFor();
        const image = await page
          .locator("yt-thumbnail-view-model")
          .boundingBox();
        const overlay = await controls.boundingBox();
        assert.ok(image && overlay);
        assert.ok(
          overlay.x >= image.x &&
            overlay.x + overlay.width <= image.x + image.width &&
            overlay.y >= image.y &&
            overlay.y + overlay.height <= image.y + image.height,
          `Overlay ${JSON.stringify(overlay)} escapes image ${JSON.stringify(image)}`,
        );
      },
      { path: "/watch?v=abcdefghijk", direction },
    ));
}

for (const width of [320, 360, 390, 412, 430, 768]) {
  void test(`mobile feedback stays below the header, navigation and player settings at ${width}px`, () =>
    fixture(
      card(),
      async (page) => {
        await page.locator(".ytt-feedback .ytt-action").first().waitFor();
        const hits = await page.evaluate(async () => {
          const action = document.querySelector<HTMLElement>(".ytt-action");
          if (!action) throw new Error("Feedback action missing");
          const nextFrame = (): Promise<void> =>
            new Promise((resolve) => requestAnimationFrame(() => resolve()));
          const targetIds = ["header-control", "navigation-control", "quality"];
          const found: string[] = [];
          for (const id of targetIds) {
            const chrome = document.getElementById(id);
            if (!chrome) throw new Error(`Native ${id} missing`);
            if (id === "quality")
              chrome
                .closest("bottom-sheet-container")
                ?.removeAttribute("hidden");
            const actionBox = action.getBoundingClientRect();
            const box = chrome.getBoundingClientRect();
            const y = box.top + box.height / 2;
            scrollBy(0, actionBox.top + actionBox.height / 2 - y);
            await nextFrame();
            const positioned = action.getBoundingClientRect();
            const x = positioned.left + positioned.width / 2;
            if (x <= box.left || x >= box.right)
              throw new Error(`Fixture does not overlap the ${id}`);
            const hit = document.elementFromPoint(x, y);
            found.push(chrome.contains(hit) ? id : (hit?.className ?? "none"));
          }
          return found;
        });
        assert.deepEqual(hits, [
          "header-control",
          "navigation-control",
          "quality",
        ]);
      },
      {
        host: mobile,
        options: { viewport: { width, height: 820 } },
        css: `
          #video {margin-block-start: 1200px}
          ytm-mobile-topbar-renderer,ytm-pivot-bar-renderer,bottom-sheet-container {position:fixed;inset-inline:0;height:48px}
          ytm-mobile-topbar-renderer {top:0;z-index:4}
          ytm-pivot-bar-renderer {bottom:0;z-index:3}
          bottom-sheet-container {bottom:100px;z-index:5}
          .ytSpecBottomSheetLayoutHost {position:relative;z-index:100}
          #header-control,#navigation-control,#quality {width:100%;height:48px}
        `,
        outsideFeed: `
          <ytm-mobile-topbar-renderer><button id="header-control">Search</button></ytm-mobile-topbar-renderer>
          <ytm-pivot-bar-renderer><button id="navigation-control">You</button></ytm-pivot-bar-renderer>
          <bottom-sheet-container hidden role="dialog"><div class="ytSpecBottomSheetLayoutHost"><button id="quality">Quality</button></div></bottom-sheet-container>
        `,
      },
    ));
}

for (const colorScheme of ["light", "dark"] as const) {
  void test(`desktop feedback inherits the native action surface in ${colorScheme} theme`, () =>
    fixture(
      card(nativeActions.replace(hideNative, "")),
      async (page) => {
        await page.locator("#video a").focus();
        const feedback = page.locator(".ytt-action").first();
        const native = page
          .locator(
            "yt-thumbnail-hover-overlay-toggle-actions-view-model button",
          )
          .first();
        await feedback.waitFor();
        const background = (element: Element): string =>
          getComputedStyle(element).backgroundColor;
        assert.equal(
          await feedback.evaluate(background),
          await native.evaluate(background),
        );
        const shape = (element: Element): string[] => {
          const css = getComputedStyle(element);
          return [css.width, css.height, css.borderRadius, css.color];
        };
        assert.deepEqual(
          await feedback.evaluate(shape),
          await native.evaluate(shape),
        );
        await native.hover();
        const hovered = await native.evaluate(background);
        await feedback.hover();
        assert.equal(await feedback.evaluate(background), hovered);
        await native.hover();
        await page.mouse.down();
        const pressed = await native.evaluate(background);
        await page.mouse.move(400, 50);
        await page.mouse.up();
        await feedback.hover();
        await page.mouse.down();
        assert.equal(await feedback.evaluate(background), pressed);
        await page.mouse.move(400, 50);
        await page.mouse.up();
      },
      { options: { colorScheme } },
    ));
}

void test("native and feedback actions appear on the same hover frame", () =>
  fixture(card(nativeActions), async (page) => {
    const native = page.locator(
      "yt-thumbnail-hover-overlay-toggle-actions-view-model",
    );
    await page.locator("#video a").hover();
    assert.deepEqual(await actionsOnFirstFrame(page), [false, false]);
    await native.evaluate(
      (element, hidden) => element.classList.remove(hidden),
      hideNative,
    );
    assert.deepEqual(await actionsOnFirstFrame(page), [true, true]);
  }));

void test("moving from a desktop thumbnail to its feedback action keeps the native actions visible", () =>
  fixture(card(nativeActions.replace(hideNative, "")), async (page) => {
    const link = page.locator("#video a");
    await link.evaluate((element, hidden) => {
      element.addEventListener("pointerleave", () =>
        element
          .querySelector("yt-thumbnail-hover-overlay-toggle-actions-view-model")
          ?.classList.add(hidden),
      );
    }, hideNative);
    await link.hover();
    await page.locator(".ytt-action").first().hover();
    assert.deepEqual(await actionsOnFirstFrame(page), [true, true]);
  }));

const previewMarkup = `<div id="video-preview"><ytd-video-preview-loader hidden><div class="ytdVideoPreviewLoaderVideoPreviewContainer ytdVideoPreviewLoaderAnchored"><ytd-video-preview class="ytdVideoPreviewActive ytdVideoPreviewFillContainer"><ytm-mute-button><button aria-label="Mute"></button></ytm-mute-button><ytm-closed-captioning-button><button aria-label="Captions"></button></ytm-closed-captioning-button></ytd-video-preview></div></ytd-video-preview-loader></div>`;

function previewFixture(run: (page: Page) => Promise<void>): Promise<void> {
  return fixture(card() + card("", "next-video"), run, {
    css: `
      ytd-video-preview-loader {position:fixed;z-index:2}
      .ytdVideoPreviewLoaderVideoPreviewContainer {width:100%;height:100%}
      ytd-video-preview {position:relative;display:block;width:100%;height:100%;background:#555}
      ytm-mute-button,ytm-closed-captioning-button {position:absolute;inset-inline-end:4px;inset-block-start:4px}
      ytm-closed-captioning-button {inset-block-start:40px}
      ytd-video-preview button {width:32px;height:32px}
    `,
    outsideFeed: previewMarkup,
  });
}

async function showPreview(page: Page): Promise<void> {
  const image = page.locator("#video yt-thumbnail-view-model");
  await image.hover();
  await page.locator("#video .ytt-action").first().waitFor();
  const imageBox = await image.boundingBox();
  assert.ok(imageBox);
  await page.locator("ytd-video-preview-loader").evaluate((element, box) => {
    if (!(element instanceof HTMLElement))
      throw new Error("Missing preview loader");
    element.hidden = false;
    element.style.left = `${box.x}px`;
    element.style.top = `${box.y}px`;
    element.style.width = `${box.width}px`;
    element.style.height = `${box.height}px`;
    element.firstElementChild?.classList.add("ytdVideoPreviewLoaderActive");
  }, imageBox);
}

void test("desktop feedback remains usable after the anchored inline preview covers the thumbnail", () =>
  previewFixture(async (page) => {
    await showPreview(page);
    const action = page.locator("ytd-video-preview").getByRole("button", {
      name: "Not interested",
      exact: true,
    });
    await action.waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Not interested", exact: true })
        .count(),
      1,
    );
    const native = page
      .locator("ytd-video-preview")
      .getByRole("button", { name: "Mute" });
    const nativeBox = await native.boundingBox();
    const actionBox = await action.boundingBox();
    assert.ok(nativeBox && actionBox);
    for (const [name, box] of [
      ["Mute", nativeBox],
      ["Not interested", actionBox],
    ] as const) {
      assert.equal(
        await page.evaluate(
          ({ x, y }) =>
            document
              .elementFromPoint(x, y)
              ?.closest("button")
              ?.getAttribute("aria-label"),
          center(box),
        ),
        name,
      );
    }
  }));

async function enterPreviewWithPointer(page: Page): Promise<void> {
  await showPreview(page);
  const player = page.locator("ytd-video-preview");
  const box = await player.boundingBox();
  assert.ok(box);
  const { x, y } = center(box);
  await page.mouse.move(x + 1, y);
  await player.locator(".ytt-action").first().waitFor();
}

void test("feedback detaches from the preview when YouTube recycles its source card", () =>
  previewFixture(async (page) => {
    await enterPreviewWithPointer(page);
    const preview = page.locator("ytd-video-preview");
    const nativeRequests = await preview.evaluate((element) => {
      const link = document.querySelector<HTMLAnchorElement>("#video a");
      const trigger = document.querySelector<HTMLButtonElement>(
        "#video .ytLockupMetadataViewModelMenuButton button",
      );
      const action = element.querySelector<HTMLButtonElement>(".ytt-action");
      if (!link || !trigger || !action)
        throw new Error("Missing fixture control");
      let requests = 0;
      trigger.addEventListener("click", () => requests++);
      link.href = "/watch?v=lmnopqrstuv";
      action.click();
      return requests;
    });
    assert.equal(nativeRequests, 0);
    await preview.locator(".ytt-feedback").waitFor({ state: "detached" });
    await page.locator("#video a").focus();
    assert.equal(await page.locator("#video .ytt-action").count(), 2);
  }));

void test("an expanded preview keeps its action when the pointer leaves the original image bounds", () =>
  previewFixture(async (page) => {
    await enterPreviewWithPointer(page);
    const loader = page.locator("ytd-video-preview-loader");
    await loader.evaluate((element) => {
      if (!(element instanceof HTMLElement))
        throw new Error("Missing preview loader");
      element.style.width = `${element.getBoundingClientRect().width + 120}px`;
    });
    await page.waitForFunction(() => {
      const action = document.querySelector("ytd-video-preview .ytt-action");
      const image = document.querySelector("#video yt-thumbnail-view-model");
      return (
        !!action &&
        !!image &&
        action.getBoundingClientRect().left >
          image.getBoundingClientRect().right
      );
    });
    const action = loader.getByRole("button", {
      name: "Not interested",
      exact: true,
    });
    await action.hover();
    assert.equal(await action.isVisible(), true);
  }));

void test("account switches are ready on the first frame of a CSS-only native menu reveal", () =>
  fixture(
    "",
    async (page) => {
      assert.equal(await page.locator("#keyboard").isVisible(), false);
      await page.setViewportSize({ width: 1280, height: 820 });
      assert.equal(await page.locator("#keyboard").isVisible(), true);
      assert.equal(await page.getByRole("menuitemcheckbox").count(), 2);
    },
    {
      options: { viewport: { width: 800, height: 820 } },
      css: `
        ytd-compact-link-renderer {display:block}
        @media (max-width:1000px) { ytd-multi-page-menu-renderer {visibility:hidden} }
      `,
      outsideFeed: `<ytd-popup-container><tp-yt-iron-dropdown opened><ytd-multi-page-menu-renderer menu-style="multi-page-menu-style-type-system"><ytd-compact-link-renderer id="keyboard">Keyboard shortcuts</ytd-compact-link-renderer></ytd-multi-page-menu-renderer></tp-yt-iron-dropdown></ytd-popup-container>`,
      beforeCandidate: `document.addEventListener("DOMContentLoaded", () => { const row = document.querySelector("#keyboard"); if (row) row.data = {icon: {iconType: "KEYBOARD"}}; });`,
    },
  ));

void test("the current account menu receives switches when an older menu is still mounted", () =>
  fixture(
    "",
    async (page) => {
      const current = page
        .locator("#current-menu")
        .getByRole("menuitemcheckbox");
      assert.equal(await current.count(), 2);
      assert.equal(
        await page.locator("#old-menu .ytt-setting-group").count(),
        0,
      );
    },
    {
      css: `
        ytd-compact-link-renderer {display:block}
        #old-menu {visibility:hidden}
      `,
      outsideFeed: `<ytd-popup-container>
        <tp-yt-iron-dropdown id="old-menu"><ytd-multi-page-menu-renderer menu-style="multi-page-menu-style-type-system"><ytd-compact-link-renderer>Keyboard shortcuts</ytd-compact-link-renderer></ytd-multi-page-menu-renderer></tp-yt-iron-dropdown>
        <tp-yt-iron-dropdown id="current-menu" opened><ytd-multi-page-menu-renderer menu-style="multi-page-menu-style-type-system"><ytd-compact-link-renderer>Keyboard shortcuts</ytd-compact-link-renderer></ytd-multi-page-menu-renderer></tp-yt-iron-dropdown>
      </ytd-popup-container>`,
      beforeCandidate: `document.addEventListener("DOMContentLoaded", () => { for (const row of document.querySelectorAll("ytd-compact-link-renderer")) row.data = {icon: {iconType: "KEYBOARD"}}; });`,
    },
  ));

const legacyCard = `<ytd-compact-video-renderer id="legacy"><ytd-thumbnail>
  <a id="thumbnail" href="/watch?v=abcdefghijk"><img alt="Video">
    <ytd-thumbnail-overlay-toggle-button-renderer><button type="button">Watch later</button></ytd-thumbnail-overlay-toggle-button-renderer>
  </a>
  </ytd-thumbnail><ytd-menu-renderer><button type="button">More</button></ytd-menu-renderer></ytd-compact-video-renderer>`;
const legacyStyles = `
  ytd-compact-video-renderer,ytd-thumbnail,#thumbnail {display:block}
  #legacy {position:relative;margin-block:80px}
  ytd-thumbnail {position:relative;width:227px}
  #thumbnail {position:relative;width:227px;height:121px}
  #thumbnail img {display:block;width:215px;height:121px}
  ytd-thumbnail-overlay-toggle-button-renderer {position:absolute;inset-inline-end:16px;inset-block-start:4px;width:32px;height:32px;visibility:hidden}
  ytd-thumbnail:hover ytd-thumbnail-overlay-toggle-button-renderer {visibility:visible}
`;

void test("legacy feedback fits the image and keeps legacy actions visible", () =>
  fixture(
    legacyCard,
    async (page) => {
      await page.locator("#thumbnail img").hover();
      const stock = page.locator(
        "ytd-thumbnail-overlay-toggle-button-renderer",
      );
      await stock.waitFor();
      const action = page.locator(".ytt-action").first();
      await action.waitFor();
      const feedbackBox = await action.boundingBox();
      const imageBox = await page.locator("#thumbnail img").boundingBox();
      assert.ok(feedbackBox && imageBox);
      assert.ok(
        feedbackBox.x + feedbackBox.width <= imageBox.x + imageBox.width,
      );
      await action.hover();
      assert.equal(await stock.isVisible(), true);
    },
    { path: "/watch?v=abcdefghijk", css: legacyStyles },
  ));

void test("the controls remain in the visible portion of a horizontally clipped thumbnail", () =>
  fixture(
    card(),
    async (page) => {
      await page.locator("#video a").evaluate((element) => {
        if (element instanceof HTMLElement)
          element.focus({ preventScroll: true });
      });
      const action = page.locator("#video .ytt-action").first();
      await action.waitFor();
      const box = await action.boundingBox();
      assert.ok(box);
      const { x, y } = center(box);
      assert.equal(
        await page.evaluate(
          ({ x, y }) =>
            Boolean(document.elementFromPoint(x, y)?.closest(".ytt-action")),
          { x, y },
        ),
        true,
      );
    },
    {
      options: { viewport: { width: 1000, height: 820 } },
      css: "#video {margin-inline-start:940px} body {overflow-x:hidden}",
    },
  ));

void test("feedback keeps keyboard focus when the pointer leaves the preview", () =>
  previewFixture(async (page) => {
    await enterPreviewWithPointer(page);
    const action = page.locator("ytd-video-preview .ytt-action").first();
    await action.focus();
    await page.locator("#next-video a").hover();
    await page
      .locator("#video .ytt-action")
      .first()
      .waitFor({ state: "attached" });
    assert.equal(
      await page.evaluate(() => document.activeElement?.closest("#video")?.id),
      "video",
    );
    assert.equal(await page.locator("#video .ytt-action:focus").count(), 1);
  }));

void test("inactive feedback leaves an anchored preview when the source becomes CSS-hidden", () =>
  previewFixture(async (page) => {
    await enterPreviewWithPointer(page);
    await page.locator("#video").evaluate((element) => {
      if (element instanceof HTMLElement) element.style.display = "none";
    });
    await page
      .locator("ytd-video-preview .ytt-feedback")
      .waitFor({ state: "detached" });
    assert.equal(
      await page.getByRole("button", { name: "Not interested" }).count(),
      0,
    );
  }));

void test("a native inline preview rerender restores one feedback panel and measures the updated controls", () =>
  previewFixture(async (page) => {
    await enterPreviewWithPointer(page);
    const preview = page.locator("ytd-video-preview");
    await preview.evaluate((element) => {
      const captions = element.querySelector("ytm-closed-captioning-button");
      if (!(captions instanceof HTMLElement))
        throw new Error("Missing captions control");
      captions.style.insetBlockStart = "90px";
      const panel = element.querySelector(".ytt-feedback");
      if (!panel) throw new Error("Missing feedback");
      panel.remove();
    });
    const captions = preview.getByRole("button", { name: "Captions" });
    const captionsBox = await captions.boundingBox();
    assert.ok(captionsBox);
    await preview.locator(".ytt-feedback").waitFor();
    assert.equal(await preview.locator(".ytt-feedback").count(), 1);
    assert.equal(
      await page.evaluate(
        ({ x, y }) =>
          document
            .elementFromPoint(x, y)
            ?.closest("button")
            ?.getAttribute("aria-label"),
        center(captionsBox),
      ),
      "Captions",
    );
  }));
