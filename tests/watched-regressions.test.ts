import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { appTag, candidate, freshPage, preference, urlFor } from "./harness.ts";
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

const segment = "ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment";

function progress(width: number): string {
  return `<yt-thumbnail-overlay-progress-bar-view-model><div class="${segment}" style="width:${width}%"></div></yt-thumbnail-overlay-progress-bar-view-model>`;
}

async function fixture(
  host: Host,
  content: string,
  run: (page: Page) => Promise<void>,
  script = "",
): Promise<void> {
  const app = appTag(host);
  await freshPage(browser, host, async (page, context) => {
    context.setDefaultTimeout(4500);
    await context.route(/^https:\/\/(?:www|m)\.youtube\.com\//, (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
        ytd-app,ytm-app,ytd-browse,ytm-browse,ytd-rich-item-renderer,ytm-rich-item-renderer,ytd-reel-item-renderer,
        ytm-video-card-renderer,ytd-video-renderer,yt-lockup-view-model,
        ytd-popup-container,tp-yt-iron-dropdown,ytd-multi-page-menu-renderer,yt-multi-page-menu-section-renderer,
        ytd-compact-link-renderer{display:block}
        #preview a{display:block;width:240px;height:100px}
      </style></head><body><${app}>${content}</${app}><script>${script}</script></body></html>`,
      }),
    );
    await candidate(context);
    await page.goto(urlFor(host, "/").href);
    await run(page);
  });
}

async function navigate(page: Page, host: Host, path: string): Promise<void> {
  await page.evaluate(
    ({ mobile, path }) => {
      history.pushState(null, "", path);
      const target = mobile ? window : document;
      target.dispatchEvent(
        new Event(mobile ? "state-navigateend" : "yt-navigate-finish"),
      );
    },
    { mobile: host === "m.youtube.com", path },
  );
}

async function browseLookups(page: Page, browse: string): Promise<number> {
  return page.evaluate(
    async ({ browse, segment }) => {
      const target = document.getElementById("mutation-target");
      if (!target) throw new Error("Missing fixture mutation target");
      const methods = ["querySelector", "querySelectorAll"] as const;
      const originals = new Map<string, PropertyDescriptor>();
      let lookups = 0;
      try {
        for (const method of methods) {
          const descriptor = Object.getOwnPropertyDescriptor(
            Element.prototype,
            method,
          );
          const original: unknown = descriptor?.value;
          if (!descriptor || typeof original !== "function")
            throw new Error(`Missing ${method}`);
          originals.set(method, descriptor);
          Object.defineProperty(Element.prototype, method, {
            ...descriptor,
            value: new Proxy(original, {
              apply(method, receiver, args) {
                const selector: unknown = args[0];
                if (
                  typeof selector === "string" &&
                  (selector.includes(browse) || selector.includes(segment))
                )
                  lookups++;
                const result: unknown = Reflect.apply(method, receiver, args);
                return result;
              },
            }),
          });
        }
        for (let index = 0; index < 4; index++) {
          const branch = document.createElement("section");
          branch.append(document.createElement("div"));
          target.append(branch);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        return lookups;
      } finally {
        for (const [method, descriptor] of originals)
          Object.defineProperty(Element.prototype, method, descriptor);
      }
    },
    { browse, segment },
  );
}

for (const [host, browse] of [
  ["www.youtube.com", "ytd-browse"],
  ["m.youtube.com", "ytm-browse"],
] as const) {
  const card = `<yt-lockup-view-model id="progress-card">Video ${progress(23)}</yt-lockup-view-model>`;
  const feed = `<${browse} page-subtype="home">${card}</${browse}>`;
  const mutations = '<div id="mutation-target"></div>';

  for (const path of [
    "/watch?v=abcdefghijk",
    "/feed/history",
    "/results?search_query=video",
  ]) {
    void test(`${host} skips inactive watched-filter lookups on ${path}`, async () => {
      await fixture(host, mutations, async (page) => {
        await page.goto(urlFor(host, path).href);
        assert.equal(
          await browseLookups(page, browse),
          0,
          "Unrelated nodes should not trigger browse or progress lookups on an inactive route",
        );

        await navigate(page, host, "/");
        await page
          .locator("#mutation-target")
          .evaluate(
            (target, view) => target.insertAdjacentHTML("afterbegin", view),
            feed,
          );
        const watched = page.locator("#progress-card");
        assert.equal(
          await watched.isVisible(),
          false,
          "Navigation should attach the filter to a late Home view",
        );

        await navigate(page, host, path);
        assert.equal(await watched.isVisible(), true);
        assert.equal(
          await browseLookups(page, browse),
          0,
          "Leaving Home should stop watched-filter browse and progress lookups",
        );
      });
    });
  }

  void test(`${host} skips watched-filter lookups while showing watched videos`, async () => {
    await fixture(host, `${mutations}${feed}`, async (page) => {
      const watched = page.locator("#progress-card");
      assert.equal(await watched.isVisible(), false);
      await preference(page, "showWatched", true);
      assert.equal(await watched.isVisible(), true);
      assert.equal(
        await browseLookups(page, browse),
        0,
        "A remote preference change should stop watched-filter lookups",
      );

      await page.reload();
      assert.equal(await watched.isVisible(), true);
      assert.equal(
        await browseLookups(page, browse),
        0,
        "A saved preference should prevent watched-filter lookups at startup",
      );

      await preference(page, "showWatched", false);
      assert.equal(
        await watched.isVisible(),
        false,
        "A remote preference change should reattach the filter",
      );
    });
  });
}

for (const [host, browse, panel, renderer] of [
  [
    "m.youtube.com",
    "ytm-browse",
    "ytm-playlist-panel-renderer",
    "ytm-video-card-renderer",
  ],
  [
    "www.youtube.com",
    "ytd-browse",
    "ytd-playlist-panel-renderer",
    "ytd-reel-item-renderer",
  ],
] as const) {
  void test(`${renderer} hides watched cards only within the filtered feed`, async () => {
    const markup = `<${browse} page-subtype="home">
      <${renderer} id="watched">Watched ${progress(23)}</${renderer}>
      <${renderer} id="unwatched">Unwatched ${progress(0)}</${renderer}>
      <${panel}><${renderer} id="playlist">Playlist ${progress(23)}</${renderer}></${panel}>
    </${browse}>`;
    await fixture(host, markup, async (page) => {
      const watched = page.locator("#watched");
      assert.equal(
        await watched.isVisible(),
        false,
        "The watched home card should be hidden",
      );
      assert.equal(await page.locator("#unwatched").isVisible(), true);
      assert.equal(await page.locator("#playlist").isVisible(), true);
      await preference(page, "showWatched", true);
      assert.equal(
        await watched.isVisible(),
        true,
        "The preference should reveal the card",
      );
      await preference(page, "showWatched", false);
      await page.goto(urlFor(host, "/feed/history").href);
      assert.equal(
        await watched.isVisible(),
        true,
        "History should remain unfiltered",
      );
    });
  });
}

for (const [host, prefix] of [
  ["www.youtube.com", "ytd"],
  ["m.youtube.com", "ytm"],
] as const) {
  void test(`${host} leaves watched Mix and playlist recommendations visible`, async () => {
    function card(id: string, list: string, collection: boolean): string {
      const thumbnail = `<yt-thumbnail-view-model>${progress(23)}</yt-thumbnail-view-model>`;
      const image = collection
        ? `<yt-collection-thumbnail-view-model>${thumbnail}</yt-collection-thumbnail-view-model>`
        : thumbnail;
      return `<${prefix}-rich-item-renderer id="${id}"><yt-lockup-view-model>
        <a class="ytLockupViewModelContentImage" href="/watch?v=abcdefghijk&amp;list=${list}">${image}</a>
        <yt-lockup-metadata-view-model>${id}</yt-lockup-metadata-view-model>
      </yt-lockup-view-model></${prefix}-rich-item-renderer>`;
    }

    const markup = `<${prefix}-browse page-subtype="home">
      ${card("mix", "RDabcdefghijk", true)}
      ${card("playlist", "PLabcdefghijk", true)}
      ${card("video", "RDabcdefghijk", false)}
      <${prefix}-rich-item-renderer><${prefix}-radio-renderer id="legacy-mix">Radio ${progress(23)}</${prefix}-radio-renderer></${prefix}-rich-item-renderer>
    </${prefix}-browse>`;
    await fixture(host, markup, async (page) => {
      assert.equal(
        await page.locator("#video yt-lockup-view-model").isVisible(),
        false,
        "Playlist navigation context does not change a video into a playlist card",
      );
      for (const id of ["mix", "playlist"]) {
        assert.equal(
          await page.locator(`#${id} yt-lockup-view-model`).isVisible(),
          true,
          `The collected thumbnail should keep ${id} visible`,
        );
      }
      assert.equal(
        await page.locator("#legacy-mix").isVisible(),
        true,
        "A native radio renderer should remain visible",
      );
    });
  });
}

for (const [host, browse, overlay, attribute, value] of [
  [
    "www.youtube.com",
    "ytd-browse",
    "yt-thumbnail-overlay-progress-bar-view-model",
    "class",
    segment,
  ],
  [
    "www.youtube.com",
    "ytd-browse",
    "ytd-thumbnail-overlay-resume-playback-renderer",
    "id",
    "progress",
  ],
  [
    "m.youtube.com",
    "ytm-browse",
    "ytw-thumbnail-overlay-resume-playback-renderer",
    "class",
    "ytwThumbnailOverlayResumePlaybackRendererThumbnailOverlayResumePlaybackProgress",
  ],
] as const) {
  void test(`${host} refreshes recycled ${overlay} progress markers`, async () => {
    const card = (
      id: string,
      marked: boolean,
    ): string => `<yt-lockup-view-model id="${id}">${id}
      <${overlay}><div data-marker style="width:23%" ${marked ? `${attribute}="${value}"` : ""}></div></${overlay}>
    </yt-lockup-view-model>`;
    const markup = `<${browse} page-subtype="home">${card("recycled", true)}${card("fresh", false)}</${browse}>`;
    await fixture(host, markup, async (page) => {
      const recycled = page.locator("#recycled");
      const fresh = page.locator("#fresh");
      const recycledMarker = recycled.locator("[data-marker]");
      const freshMarker = fresh.locator("[data-marker]");

      assert.equal(await recycled.isVisible(), false);
      assert.equal(await fresh.isVisible(), true);
      await recycledMarker.evaluate(
        (marker, key) => marker.removeAttribute(key),
        attribute,
      );
      assert.equal(
        await recycled.isVisible(),
        true,
        "A recycled decoration must no longer hide the video",
      );
      for (const marker of [recycledMarker, freshMarker]) {
        await marker.evaluate(
          (element, [key, mark]) => element.setAttribute(key, mark),
          [attribute, value] as const,
        );
      }
      assert.equal(
        await recycled.isVisible(),
        false,
        "A recycled marker can show progress again",
      );
      assert.equal(
        await fresh.isVisible(),
        false,
        "A new marker can gain progress without a width change",
      );

      await preference(page, "showWatched", true);
      assert.equal(await recycled.isVisible(), true);
      assert.equal(await fresh.isVisible(), true);
      await recycledMarker.evaluate(
        (element, key) => element.removeAttribute(key),
        attribute,
      );
      await preference(page, "showWatched", false);
      assert.equal(
        await recycled.isVisible(),
        true,
        "Re-enabling filtering must discard a marker recycled while it was off",
      );
      assert.equal(await fresh.isVisible(), false);
    });
  });
}

void test("desktop only uses legacy progress inside its native overlay", async () => {
  const markup = `<ytd-browse page-subtype="home"><ytd-video-renderer id="recycled">Video
    <ytd-thumbnail-overlay-resume-playback-renderer><div id="progress" style="width:23%"></div></ytd-thumbnail-overlay-resume-playback-renderer>
  </ytd-video-renderer></ytd-browse>`;
  await fixture("www.youtube.com", markup, async (page) => {
    const card = page.locator("#recycled");
    const marker = card.locator("#progress");
    const overlay = card.locator(
      "ytd-thumbnail-overlay-resume-playback-renderer",
    );
    assert.equal(await card.isVisible(), false);
    await overlay.evaluate((element) => element.after(...element.childNodes));
    assert.equal(
      await card.isVisible(),
      true,
      "A reused node outside the overlay is not a progress marker",
    );
    await marker.evaluate((element) =>
      element.previousElementSibling?.append(element),
    );
    assert.equal(
      await card.isVisible(),
      false,
      "Moving the node back into the native overlay restores progress",
    );
  });
});

void test("desktop keeps a hovered card visible when YouTube replaces its progress overlay", async () => {
  const markup = `<ytd-browse page-subtype="home"><ytd-video-renderer id="preview">
    <a href="/watch?v=abcdefghijk">Video ${progress(0)}</a>
  </ytd-video-renderer></ytd-browse>`;
  await fixture("www.youtube.com", markup, async (page) => {
    const card = page.locator("#preview");
    await card.locator("a").hover();
    await card
      .locator("yt-thumbnail-overlay-progress-bar-view-model")
      .evaluate((overlay, replacement) => {
        overlay.outerHTML = replacement;
      }, progress(23));
    assert.equal(
      await card.isVisible(),
      true,
      "Progress should not hide a card under the pointer",
    );
    await page.mouse.move(0, 0);
    assert.equal(
      await card.isVisible(),
      false,
      "Moving the pointer away should hide the watched card",
    );
  });
});

void test("desktop settings wait for a unique keyboard shortcuts row", async () => {
  const menu = `<ytd-popup-container><tp-yt-iron-dropdown aria-hidden="false"><ytd-multi-page-menu-renderer>
    <yt-multi-page-menu-section-renderer><ytd-compact-link-renderer id="duplicate-keyboard">Keyboard shortcuts</ytd-compact-link-renderer></yt-multi-page-menu-section-renderer>
    <yt-multi-page-menu-section-renderer id="keyboard-section"><ytd-compact-link-renderer id="keyboard">Keyboard shortcuts</ytd-compact-link-renderer></yt-multi-page-menu-section-renderer>
  </ytd-multi-page-menu-renderer></tp-yt-iron-dropdown></ytd-popup-container>`;
  const script = `for (const id of ['duplicate-keyboard', 'keyboard']) document.getElementById(id).data = { icon: { iconType: 'KEYBOARD' } };`;
  await fixture(
    "www.youtube.com",
    menu,
    async (page) => {
      const popup = page.locator("tp-yt-iron-dropdown");
      await popup.dispatchEvent("iron-overlay-opened");
      assert.equal(
        await popup.getByRole("menuitemcheckbox").count(),
        0,
        "An ambiguous menu should receive neither switch",
      );

      await page.locator("#duplicate-keyboard").evaluate((row) => row.remove());
      await popup.dispatchEvent("iron-overlay-opened");
      const section = popup.locator("#keyboard-section");
      for (const name of ["Watched videos", "Audio only"]) {
        const control = section.getByRole("menuitemcheckbox", {
          name,
          exact: true,
        });
        await control.waitFor({ state: "visible" });
        assert.equal(await control.getAttribute("aria-checked"), "false");
      }
      assert.equal(await popup.getByRole("menuitemcheckbox").count(), 2);
    },
    script,
  );
});
