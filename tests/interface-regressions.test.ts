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

function card(content = "", id = "video", video = "abcdefghijk"): string {
  return `<yt-lockup-view-model id="${id}">
    <a class="ytLockupViewModelContentImage" href="/watch?v=${video}">
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

void test("moving between native and script actions keeps both visible", () =>
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
    const feedback = page.locator(".ytt-action").first();
    const stock = page.locator(
      "yt-thumbnail-hover-overlay-toggle-actions-view-model button",
    );
    await feedback.hover();
    await stock.first().evaluate((element, hidden) => {
      element
        .closest("yt-thumbnail-hover-overlay-toggle-actions-view-model")
        ?.classList.add(hidden);
    }, hideNative);
    assert.deepEqual(await actionsOnFirstFrame(page), [true, true]);
    const feedbackBox = await feedback.boundingBox();
    const nativeBox = await stock.last().boundingBox();
    assert.ok(feedbackBox && nativeBox);
    const gap = feedbackBox.y - nativeBox.y - nativeBox.height;
    assert.ok(gap > 0);
    await page.mouse.move(center(feedbackBox).x, feedbackBox.y - gap / 2);
    assert.deepEqual(await actionsOnFirstFrame(page), [true, true]);
    await stock.first().hover();
    assert.deepEqual(await actionsOnFirstFrame(page), [true, true]);
  }));

const previewMarkup = `<div id="video-preview"><ytd-video-preview-loader hidden><div class="ytdVideoPreviewLoaderVideoPreviewContainer ytdVideoPreviewLoaderAnchored"><ytd-video-preview class="ytdVideoPreviewActive ytdVideoPreviewFillContainer"><ytm-mute-button><button aria-label="Mute"></button></ytm-mute-button><ytm-closed-captioning-button><button aria-label="Captions"></button></ytm-closed-captioning-button></ytd-video-preview></div></ytd-video-preview-loader></div>`;

function previewFixture(run: (page: Page) => Promise<void>): Promise<void> {
  return fixture(card() + card("", "next-video", "lmnopqrstuv"), run, {
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

void test("an active inline preview cannot pick up feedback for a different intersecting card", () =>
  previewFixture(async (page) => {
    await enterPreviewWithPointer(page);
    const nextImage = await page
      .locator("#next-video yt-thumbnail-view-model")
      .boundingBox();
    assert.ok(nextImage);
    const loader = page.locator("ytd-video-preview-loader");
    await loader.evaluate((element, box) => {
      if (!(element instanceof HTMLElement)) throw new Error("Missing preview");
      element.style.height = `${box.y + box.height * 0.75 - element.getBoundingClientRect().top}px`;
    }, nextImage);
    const x = nextImage.x + nextImage.width / 2;
    const y = nextImage.y + nextImage.height;
    await page.mouse.move(x, y - 4);
    assert.equal(
      await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.closest("#next-video")?.id,
        { x, y: y - 4 },
      ),
      "next-video",
    );
    await page.mouse.move(x, y - nextImage.height / 2);
    const wrongRequests = await page.evaluate(() => {
      const trigger = document.querySelector<HTMLButtonElement>(
        "#next-video .ytLockupMetadataViewModelMenuButton button",
      );
      if (!trigger) throw new Error("Missing second card menu");
      let requests = 0;
      trigger.addEventListener("click", () => requests++);
      document
        .querySelector<HTMLButtonElement>("ytd-video-preview .ytt-action")
        ?.click();
      return requests;
    });
    assert.equal(wrongRequests, 0);

    await loader.evaluate((element, box) => {
      if (!(element instanceof HTMLElement)) throw new Error("Missing preview");
      const preview = element.querySelector("ytd-video-preview");
      if (!preview) throw new Error("Missing native preview");
      preview.classList.remove("ytdVideoPreviewActive");
      element.style.top = `${box.y}px`;
      element.style.height = `${box.height}px`;
      preview.classList.add("ytdVideoPreviewActive");
    }, nextImage);
    await loader.locator(".ytt-action").first().waitFor();
  }));

void test("same-route YouTube events leave feedback on the active inline preview", () =>
  previewFixture(async (page) => {
    await enterPreviewWithPointer(page);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("yt-page-type-changed"));
      document.dispatchEvent(new Event("yt-navigate-finish"));
    });
    assert.equal(
      await page.locator("ytd-video-preview .ytt-action").count(),
      2,
    );
  }));

void test("Tab reaches both actions in card order while its inline preview is active", () =>
  previewFixture(async (page) => {
    await enterPreviewWithPointer(page);
    await page.locator("#video a").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    assert.equal(
      await page.locator(":focus").getAttribute("aria-label"),
      "Not interested",
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await page.locator(":focus").getAttribute("aria-label"),
      "Don't recommend channel",
    );
    await page.keyboard.press("Tab");
    assert.equal(await page.locator("#next-video a:focus").count(), 1);
  }));

void test("mobile horizontal scrolling reveals feedback on a thumbnail entering the viewport", () =>
  fixture(
    `<div id="shelf"><div id="track">${card()}</div></div>`,
    async (page) => {
      const action = page.locator(".ytt-action").first();
      await action.waitFor({ state: "attached" });
      await action.waitFor({ state: "hidden" });
      await page.locator("#shelf").evaluate((element) => {
        element.scrollLeft = 420;
      });
      await action.waitFor();
      const box = await action.boundingBox();
      assert.ok(box);
      assert.ok(box.x >= 0 && box.x + box.width <= 412);
    },
    {
      host: mobile,
      options: { viewport: { width: 412, height: 820 } },
      css: "#shelf {overflow-x:auto;width:100vw} #track {width:1000px} #video {margin-inline-start:420px}",
    },
  ));

void test("touch reaches the native player settings, submenu and scrim above both feedback actions", () =>
  fixture(
    card(),
    async (page) => {
      const drawer = page.locator("bottom-sheet-container");
      await drawer.evaluate((element) => {
        const menu = element.querySelector("button[role=menuitem]");
        const scrim = element.querySelector("button[aria-label=Scrim]");
        const close = element.querySelector("button[aria-label=Close]");
        if (!menu || !scrim || !close)
          throw new Error("Missing native controls");
        scrim.addEventListener("click", () =>
          element.setAttribute("data-scrim", "hit"),
        );
        menu.addEventListener("click", () => {
          const submenu = menu.textContent === "Auto";
          element.setAttribute("data-view", submenu ? "submenu" : "quality");
          menu.textContent = "Auto";
        });
        close.addEventListener("click", () =>
          element.setAttribute("hidden", ""),
        );
      });
      const buttons = page.locator(".ytt-action");
      await buttons.first().waitFor({ state: "attached" });
      const [first, second] = await buttons.all();
      assert.ok(first && second);
      await first.waitFor();
      const firstBox = await first.boundingBox();
      const secondBox = await second.boundingBox();
      assert.ok(firstBox && secondBox);
      const a = center(firstBox);
      const b = center(secondBox);
      await drawer.evaluate(
        (element, top) => {
          if (!(element instanceof HTMLElement))
            throw new Error("Missing settings drawer");
          element.style.setProperty("--settings-top", `${top}px`);
          element.hidden = false;
        },
        (a.y + b.y) / 2,
      );
      await page.touchscreen.tap(a.x, a.y);
      assert.equal(await drawer.getAttribute("data-scrim"), "hit");
      await page.touchscreen.tap(b.x, b.y);
      assert.equal(await drawer.getAttribute("data-view"), "quality");
      await page.touchscreen.tap(b.x, b.y);
      assert.equal(await drawer.getAttribute("data-view"), "submenu");
      await drawer.getByRole("button", { name: "Close" }).tap();
      for (const point of [a, b])
        assert.equal(
          await page.evaluate(
            ({ x, y }) =>
              Boolean(document.elementFromPoint(x, y)?.closest(".ytt-action")),
            point,
          ),
          true,
        );
    },
    {
      host: mobile,
      path: "/watch?v=abcdefghijk",
      css: `
        bottom-sheet-container {position:fixed;inset:0;z-index:5}
        bottom-sheet-container > button[aria-label=Scrim] {position:absolute;inset:0}
        bottom-sheet-container > button[role=menuitem] {position:absolute;inset:var(--settings-top) 0 auto;height:48px}
        bottom-sheet-container > button[aria-label=Close] {position:absolute;top:0;left:0}
      `,
      outsideFeed:
        '<bottom-sheet-container hidden role="dialog"><button aria-label="Scrim"></button><button role="menuitem">Quality</button><button aria-label="Close"></button></bottom-sheet-container>',
    },
  ));

void test("restarting the same native preview cannot retain an earlier hover's actions", () =>
  previewFixture(async (page) => {
    await enterPreviewWithPointer(page);
    const player = page.locator("ytd-video-preview");
    await player.evaluate((element) => {
      element.classList.remove("ytdVideoPreviewActive");
      element.classList.add("ytdVideoPreviewActive");
    });
    await player.locator(".ytt-feedback").waitFor({ state: "detached" });
  }));

void test("Tab after pointer focus inside the preview continues with the next card", () =>
  previewFixture(async (page) => {
    await enterPreviewWithPointer(page);
    const first = page.locator("ytd-video-preview .ytt-action").first();
    await first.evaluate((button) => {
      button.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
        },
        { capture: true },
      );
    });
    await first.click();
    await page.keyboard.press("Tab");
    assert.equal(
      await page.locator(":focus").getAttribute("aria-label"),
      "Don't recommend channel",
    );
    await page.keyboard.press("Tab");
    assert.equal(await page.locator("#next-video a:focus").count(), 1);
  }));

void test("feedback fits the visible thumbnail inside a shelf narrower than the viewport", () =>
  fixture(
    `<div id="shelf"><div id="track">${card()}</div></div>`,
    async (page) => {
      const action = page.locator(".ytt-action").first();
      await action.waitFor();
      const box = await action.boundingBox();
      const shelf = await page.locator("#shelf").boundingBox();
      assert.ok(box && shelf);
      assert.ok(box.x >= shelf.x && box.x + box.width <= shelf.x + shelf.width);
    },
    {
      host: mobile,
      options: { viewport: { width: 412, height: 820 } },
      css: "#shelf {overflow-x:auto;width:380px} #track {width:1000px} #video {margin-inline-start:280px}",
    },
  ));

void test("hiding and revealing the preview node ends the earlier feedback ownership", () =>
  previewFixture(async (page) => {
    await enterPreviewWithPointer(page);
    const player = page.locator("ytd-video-preview");
    await player.evaluate((element) => {
      if (!(element instanceof HTMLElement)) throw new Error("Missing preview");
      element.hidden = true;
      element.hidden = false;
    });
    await player.locator(".ytt-feedback").waitFor({ state: "detached" });
  }));

void test("the keyboard action panel remains inside its shelf when the preview overflows it", () =>
  previewFixture(async (page) => {
    await page.locator("#video").evaluate((element) => {
      const shelf = document.createElement("div");
      shelf.id = "clipping-shelf";
      shelf.style.width = "180px";
      shelf.style.overflowX = "hidden";
      element.before(shelf);
      shelf.append(element);
    });
    await enterPreviewWithPointer(page);
    await page.locator("#video a").evaluate((element) => {
      if (element instanceof HTMLElement)
        element.focus({ preventScroll: true });
    });
    const action = page.locator("#video .ytt-action").first();
    await action.waitFor();
    const box = await action.boundingBox();
    const shelf = await page.locator("#clipping-shelf").boundingBox();
    assert.ok(box && shelf);
    assert.ok(box.x >= shelf.x && box.x + box.width <= shelf.x + shelf.width);
  }));

void test("CSS-only shelf width changes keep the existing thumbnail controls in view", () =>
  fixture(
    `<div id="shelf"><div id="track">${card()}</div></div>`,
    async (page) => {
      const action = page.locator(".ytt-action").first();
      await action.waitFor();
      const shelf = page.locator("#shelf");
      const before = await action.boundingBox();
      const shelfBefore = await shelf.boundingBox();
      assert.ok(before && shelfBefore);
      assert.ok(before.x + before.width <= shelfBefore.x + shelfBefore.width);
      await shelf.evaluate((element) => {
        if (element instanceof HTMLElement) element.style.width = "0";
      });
      await action.waitFor({ state: "hidden" });
      await shelf.evaluate((element) => {
        if (element instanceof HTMLElement) element.style.width = "320px";
      });
      await page.waitForFunction(() => {
        const action = document.querySelector(".ytt-action");
        const shelf = document.getElementById("shelf");
        if (!action || !shelf) return false;
        const button = action.getBoundingClientRect();
        const clip = shelf.getBoundingClientRect();
        return (
          button.width > 0 &&
          button.left >= clip.left &&
          button.right <= clip.right
        );
      });
    },
    {
      host: mobile,
      options: { viewport: { width: 412, height: 820 } },
      css: "#shelf {overflow-x:auto;width:380px} #track {width:1000px} #video {margin-inline-start:280px}",
    },
  ));

void test("an opaque mobile top bar without a pointer target never exposes a hidden feedback hit region", () =>
  fixture(
    card(),
    async (page) => {
      const action = page.locator(".ytt-action").first();
      await action.waitFor();
      const start = await action.boundingBox();
      assert.ok(start);
      await page.evaluate(
        (point) => window.scrollTo(0, point.y - 24),
        center(start),
      );
      const box = await action.boundingBox();
      assert.ok(box);
      const at = center(box);
      const header = await page
        .locator("ytm-mobile-topbar-renderer")
        .boundingBox();
      assert.ok(header && at.y > header.y && at.y < header.y + header.height);
      await page.waitForFunction(
        ({ x, y }) => !document.elementFromPoint(x, y)?.closest(".ytt-action"),
        at,
      );
      assert.equal(
        await action.evaluate((e) => e instanceof HTMLElement && e.inert),
        true,
      );
      await page.locator("ytm-mobile-topbar-renderer").evaluate((element) => {
        if (element instanceof HTMLElement) element.hidden = true;
      });
      await page.waitForFunction(
        ({ x, y }) =>
          Boolean(document.elementFromPoint(x, y)?.closest(".ytt-action")),
        at,
      );
      assert.equal(
        await action.evaluate((e) => e instanceof HTMLElement && e.inert),
        false,
      );
      const bar = page.locator("ytm-mobile-topbar-renderer");
      await bar.evaluate((element) => {
        if (element instanceof HTMLElement) element.hidden = false;
      });
      await page.waitForFunction(
        ({ x, y }) => !document.elementFromPoint(x, y)?.closest(".ytt-action"),
        at,
      );
      await bar.evaluate((element) => element.remove());
      await page.waitForFunction(
        ({ x, y }) =>
          Boolean(document.elementFromPoint(x, y)?.closest(".ytt-action")),
        at,
      );
      await page.locator("ytm-app").evaluate((element) => {
        element.append(document.createElement("ytm-mobile-topbar-renderer"));
      });
      await page.waitForFunction(
        ({ x, y }) => !document.elementFromPoint(x, y)?.closest(".ytt-action"),
        at,
      );
      await bar.evaluate((element) => {
        if (element instanceof HTMLElement) element.style.height = "4px";
      });
      await page.waitForFunction(
        ({ x, y }) =>
          Boolean(document.elementFromPoint(x, y)?.closest(".ytt-action")),
        at,
      );
    },
    {
      host: mobile,
      options: { viewport: { width: 768, height: 820 } },
      css: "ytm-mobile-topbar-renderer {position:fixed;inset:0 0 auto;height:48px;background:#111;pointer-events:none;z-index:4}",
      outsideFeed: "<ytm-mobile-topbar-renderer></ytm-mobile-topbar-renderer>",
    },
  ));
