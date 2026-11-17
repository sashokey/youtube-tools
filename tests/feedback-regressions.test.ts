import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import {
  appTag,
  candidate,
  freshPage,
  hosts,
  preference,
  urlFor,
} from "./harness.ts";
import type { Host } from "./harness.ts";
import { translations } from "./locales.ts";

let browser: Browser;
before(async () => {
  browser = await chromium.launch({
    args: ["--disable-extensions", "--mute-audio"],
  });
});
after(async () => {
  await browser?.close();
});

const interest = "Not interested";
const channel = "Don't recommend channel";
const interestIcon =
  "M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 018.246 12.605L4.755 6.661A8.99 8.99 0 0112 3ZM3.754 8.393l15.491 8.944A9 9 0 013.754 8.393Z";
const channelIcon =
  "M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 110 18.001A9 9 0 0112 3Zm4 8H8a1 1 0 000 2h8a1 1 0 000-2Z";
const nativeLabels: Record<
  string,
  Partial<Record<"interest" | "channel", string>>
> = {
  "zh-CN": { channel: "不要推荐此频道" },
  "hi-IN": { channel: "यह चैनल न सुझाएं" },
  "es-419": { channel: "No recomendar el canal" },
  ar: { interest: "لا يهمّني" },
  "fr-FR": { channel: "Ne pas recommander la chaîne" },
  "bn-BD": { channel: "চ্যানেল সাজেস্ট করবেন না" },
  "ur-PK": { channel: "چینل کی تجویز نہ کریں" },
  "ru-RU": { channel: "Не рекомендовать видео с этого канала" },
  "de-DE": { channel: "Keine Videos von diesem Kanal empfehlen" },
  "ja-JP": { interest: "興味がない" },
};

type Row = {
  key: string;
  label: string;
  icon?: string;
  attributes?: string;
  rowAttributes?: string;
};
type Menu = {
  rows?: Row[];
  delayed?: boolean;
  linkToCard?: boolean;
  unrelatedPopup?: boolean;
  conflictingRow?: boolean;
  noNativeClose?: boolean;
  nativeNoop?: boolean;
};
type Fixture = {
  host?: Host;
  contents?: string;
  pageManager?: boolean;
  language?: string;
  rtl?: boolean;
  menu?: Menu;
};

function card(id: string, video: string, tag = "yt-lockup-view-model"): string {
  const lockup = tag === "yt-lockup-view-model";
  const trigger =
    '<button type="button" class="fixture-trigger" aria-label="Action menu">More</button>';
  const menu = lockup
    ? `<div class="ytLockupMetadataViewModelMenuButton">${trigger}</div>`
    : `<ytd-menu-renderer>${trigger}</ytd-menu-renderer>`;
  const thumbnail = lockup
    ? 'class="ytLockupViewModelContentImage"'
    : 'id="thumbnail"';
  return `<${tag} id="${id}" data-video-card><a ${thumbnail} href="/watch?v=${video}"><img alt="${id}"></a>${menu}</${tag}>`;
}

function installNativeMenu({
  rows,
  delayed,
  linkToCard,
  unrelatedPopup,
  conflictingRow,
  noNativeClose,
  nativeNoop,
}: Required<Menu>): void {
  const mobile = location.hostname === "m.youtube.com";
  const openers = new WeakMap<Element, () => void>();
  for (const card of document.querySelectorAll<HTMLElement>(
    "[data-video-card]",
  )) {
    const trigger = card.querySelector("button.fixture-trigger");
    const original = [card.querySelector("a"), trigger?.parentElement];
    const rowData = (id: string, key: string) => ({
      rendererContext: {
        commandContext: {
          onTap: {
            innertubeCommand: {
              feedbackEndpoint: { feedbackToken: `${id}:${key}` },
            },
          },
        },
      },
    });
    const itemData = rows.map(({ key }) => rowData(card.id, key));
    if (linkToCard && mobile && trigger) {
      const view = document.createElement("button-view-model");
      const listViewModel = {
        listItems: itemData.map((listItemViewModel) => ({ listItemViewModel })),
      };
      const inlineContent = { sheetViewModel: { content: { listViewModel } } };
      const innertubeCommand = {
        showSheetCommand: { panelLoadingStrategy: { inlineContent } },
      };
      Object.assign(view, { data: { onTap: { innertubeCommand } } });
      trigger.before(view);
      view.append(trigger);
    }
    trigger?.addEventListener("click", () => {
      const originalVideo = card.querySelector("a")?.getAttribute("href") ?? "";
      card.dataset["menuOpens"] = String(
        Number(card.dataset["menuOpens"] ?? "0") + 1,
      );
      const open = (): void => {
        const menu = document.createElement("yt-sheet-view-model");
        const dropdown = document.createElement("tp-yt-iron-dropdown");
        menu.setAttribute("role", "menu");
        menu.dataset["owner"] = card.id;
        if (linkToCard && !mobile)
          Object.assign(menu, { positionTarget: trigger });
        const close = (): void => {
          (noNativeClose ? menu : dropdown).remove();
          document.body.removeEventListener("click", dismiss);
        };
        const dismiss = (event: MouseEvent): void => {
          if (event.target === document.body) close();
        };
        for (const [
          index,
          { key, label, icon, attributes = "", rowAttributes = "" },
        ] of rows.entries()) {
          menu.insertAdjacentHTML(
            "beforeend",
            `<yt-list-item-view-model ${rowAttributes}><button type="button" role="menuitem" ${attributes}>${icon ? `<svg width="24" height="24" aria-hidden="true"><path d="${icon}"></path></svg>` : ""}</button></yt-list-item-view-model>`,
          );
          const wrong = conflictingRow && key === "channel";
          if (linkToCard && mobile && key === "channel")
            Object.assign(menu.lastElementChild ?? {}, {
              data: wrong ? rowData("beta", key) : itemData[index],
            });
          const data = itemData[index];
          const targetId: unknown = data && Reflect.get(data, "targetId");
          if (!wrong && typeof targetId === "string")
            menu.lastElementChild?.setAttribute("data-target-id", targetId);
          const button = menu.lastElementChild?.querySelector("button");
          if (!button) throw new Error("Missing native menu button");
          button.append(label);
          button.addEventListener("click", () => {
            card.dataset["nativeClicks"] = String(
              Number(card.dataset["nativeClicks"] ?? "0") + 1,
            );
            if (nativeNoop) {
              close();
              return;
            }
            if (wrong) {
              document
                .querySelector("#beta")
                ?.setAttribute("data-selection", key);
              close();
              return;
            }
            card.dataset["selection"] = `${key}:${originalVideo}`;
            const undo = document.createElement("button");
            undo.type = "button";
            undo.textContent = "Undo";
            undo.addEventListener("click", () =>
              card.replaceChildren(
                ...original.filter(
                  (node) => node !== null && node !== undefined,
                ),
              ),
            );
            card.replaceChildren(undo);
            close();
          });
        }
        if (noNativeClose) document.body.append(menu);
        else {
          Object.assign(dropdown, { close });
          dropdown.append(menu);
          document.body.append(dropdown);
        }
        document.body.addEventListener("click", dismiss);
      };
      if (delayed) openers.set(card, open);
      else open();
      if (unrelatedPopup) {
        const unrelated = document.createElement("yt-sheet-view-model");
        unrelated.setAttribute("role", "menu");
        unrelated.dataset["owner"] = "unrelated";
        unrelated.innerHTML =
          '<yt-list-item-view-model><button role="menuitem">Not interested</button></yt-list-item-view-model>';
        unrelated.querySelector("button")?.addEventListener("click", () => {
          unrelated.dataset["selected"] = "yes";
        });
        document.body.append(unrelated);
      }
    });
  }
  document.addEventListener("fixture-open-native-menu", (event) => {
    if (!(event.target instanceof Element)) return;
    const open = openers.get(event.target);
    openers.delete(event.target);
    open?.();
  });
}

async function fixture(
  run: (page: Page) => Promise<void>,
  options: Fixture = {},
): Promise<void> {
  const {
    host = "www.youtube.com",
    contents = card("alpha", "abcdefghijk"),
    pageManager = true,
    language = "en-US",
    rtl = false,
    menu = {},
  } = options;
  const app = appTag(host);
  const prefix = host === "m.youtube.com" ? "ytm" : "ytd";
  const rows = menu.rows ?? [
    { key: "interest", label: interest },
    { key: "channel", label: channel },
  ];
  await freshPage(browser, host, async (page, context) => {
    context.setDefaultTimeout(4000);
    await context.route(/^https:\/\/(?:www|m)\.youtube\.com\//, (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html lang="${language}" dir="${rtl ? "rtl" : "ltr"}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        ytd-app,ytm-app,ytd-browse,ytm-browse,yt-lockup-view-model,ytd-rich-item-renderer,yt-list-item-view-model{display:block}
        [data-video-card]{width:min(300px,80vw);margin-block:12px}
        a:has(img){display:block;width:100%;height:100px;background:#ddd}
        [hidden]{display:none!important}
        yt-sheet-view-model{display:block;position:fixed;z-index:10;bottom:0;inset-inline-start:0;background:white}
      </style></head><body><button type="button">Outside</button><${app}>${pageManager ? `<${prefix}-page-manager>${contents}</${prefix}-page-manager>` : contents}</${app}></body></html>`,
      }),
    );
    await candidate(context);
    await page.goto(urlFor(host, "/").href);
    await page.evaluate(installNativeMenu, {
      rows,
      delayed: menu.delayed ?? false,
      linkToCard: menu.linkToCard ?? true,
      unrelatedPopup: menu.unrelatedPopup ?? false,
      conflictingRow: menu.conflictingRow ?? false,
      noNativeClose: menu.noNativeClose ?? false,
      nativeNoop: menu.nativeNoop ?? false,
    });
    await run(page);
  });
}

async function quickAction(
  page: Page,
  id: string,
  name: string,
): Promise<void> {
  const target = page.locator(`#${id}`);
  await target.getByRole("link").focus();
  await target.getByRole("button", { name, exact: true }).click();
}

async function revealNativeMenu(page: Page, id: string): Promise<void> {
  await page.locator(`#${id}`).evaluate((element) => {
    element.dispatchEvent(
      new Event("fixture-open-native-menu", { bubbles: true }),
    );
  });
}

for (const host of hosts) {
  const pair = card("alpha", "abcdefghijk") + card("beta", "lmnopqrstuv");

  for (const change of ["removes", "moves"] as const) {
    void test(`${host} rebuilds feedback when a native render ${change} the controls while keeping the thumbnail`, () =>
      fixture(
        async (page) => {
          const card = page.locator("#alpha");
          await card.getByRole("link").focus();
          const overlay = card.locator(".ytt-feedback");
          await overlay.waitFor({ state: "attached" });
          await overlay.evaluate((element, movement) => {
            element.id = "obsolete-overlay";
            if (movement === "moves") document.body.append(element);
            else element.remove();
          }, change);
          await card
            .getByRole("button", { name: interest, exact: true })
            .waitFor({ timeout: 1500 });
          assert.equal(await overlay.count(), 1);
          assert.equal(await page.locator("#obsolete-overlay").count(), 0);
        },
        { host },
      ));
  }

  void test(`${host} reports Unavailable when native feedback leaves the card unchanged`, () =>
    fixture(
      async (page) => {
        await page.clock.install();
        await quickAction(page, "alpha", interest);
        const card = page.locator("#alpha");
        assert.equal(await card.getAttribute("data-native-clicks"), "1");
        await page.clock.fastForward(2600);
        await card
          .getByRole("button", { name: "Unavailable", exact: true })
          .waitFor({ timeout: 900 });
        assert.equal(await card.getAttribute("data-native-clicks"), "1");
        assert.equal(await card.getByRole("link").isVisible(), true);
      },
      { host, menu: { nativeNoop: true } },
    ));

  void test(`${host} an undismissable feedback menu cannot close an unrelated account menu`, () =>
    fixture(
      async (page) => {
        await page.clock.install();
        await page.evaluate(() => {
          const account = document.createElement(
            "ytd-multi-page-menu-renderer",
          );
          account.id = "account-menu";
          account.textContent = "Account options";
          document.body.append(account);
          const onBodyClick = (event: MouseEvent): void => {
            if (event.target === document.body) account.remove();
          };
          document.body.addEventListener("click", onBodyClick);
        });
        await quickAction(page, "alpha", interest);
        await page.clock.fastForward(2000);
        await page
          .locator("#alpha")
          .getByRole("button", { name: "Unavailable", exact: true })
          .waitFor();
        assert.equal(await page.locator("#account-menu").isVisible(), true);
      },
      {
        host,
        menu: {
          noNativeClose: true,
          rows: [{ key: "channel", label: channel }],
        },
      },
    ));

  void test(`${host} an unlinked popup opened during the native click cannot receive feedback`, () =>
    fixture(
      async (page) => {
        await quickAction(page, "alpha", interest);
        const unrelated = page.locator('[data-owner="unrelated"]');
        await unrelated.waitFor();
        assert.equal(await unrelated.getAttribute("data-selected"), null);
        await revealNativeMenu(page, "alpha");
        assert.equal(
          await page.locator("#alpha").getAttribute("data-selection"),
          "interest:/watch?v=abcdefghijk",
        );
        assert.equal(await unrelated.getAttribute("data-selected"), null);
      },
      { host, menu: { delayed: true, unrelatedPopup: true } },
    ));

  void test(`${host} an unavailable action leaves a separately opened native menu intact`, () =>
    fixture(
      async (page) => {
        await page.clock.install();
        await page.locator("#beta .fixture-trigger").click();
        await quickAction(page, "alpha", interest);
        await revealNativeMenu(page, "beta");
        await revealNativeMenu(page, "alpha");
        await page.clock.fastForward(2000);
        await page
          .locator("#alpha")
          .getByRole("button", { name: "Unavailable", exact: true })
          .waitFor();
        const unrelated = page.locator('[data-owner="beta"]');
        assert.equal(await unrelated.isVisible(), true);
        assert.equal(
          await unrelated.evaluate(
            (menu) => getComputedStyle(menu).pointerEvents,
          ),
          "auto",
        );
      },
      {
        host,
        contents: pair,
        menu: {
          delayed: true,
          noNativeClose: true,
          rows: [{ key: "channel", label: channel }],
        },
      },
    ));

  void test(`${host} an earlier unrelated popup cannot intercept a quick feedback action`, () =>
    fixture(
      async (page) => {
        const alpha = page.locator("#alpha");
        const beta = page.locator("#beta");
        await beta.locator(".fixture-trigger").click();
        await quickAction(page, "alpha", interest);
        await revealNativeMenu(page, "beta");
        assert.equal(await beta.getAttribute("data-selection"), null);
        const unrelated = page
          .getByRole("menu")
          .filter({ has: page.getByRole("menuitem", { name: channel }) });
        assert.equal(
          await unrelated.evaluate(
            (menu) => getComputedStyle(menu).pointerEvents,
          ),
          "auto",
        );
        await revealNativeMenu(page, "alpha");
        assert.equal(
          await alpha.getAttribute("data-selection"),
          "interest:/watch?v=abcdefghijk",
        );
        assert.equal(await beta.getAttribute("data-selection"), null);
      },
      { host, contents: pair, menu: { delayed: true } },
    ));

  void test(`${host} feedback works again after a native menu times out`, () =>
    fixture(
      async (page) => {
        await page.clock.install();
        await quickAction(page, "alpha", interest);
        await page.clock.fastForward(2000);
        await page
          .locator("#alpha")
          .getByRole("button", { name: "Unavailable", exact: true })
          .waitFor();
        await quickAction(page, "beta", channel);
        await revealNativeMenu(page, "beta");
        assert.equal(
          await page.locator("#beta").getAttribute("data-selection"),
          "channel:/watch?v=lmnopqrstuv",
        );
      },
      { host, contents: pair, menu: { delayed: true } },
    ));

  void test(`${host} an unlinked delayed menu leaves the choice to the user`, () =>
    fixture(
      async (page) => {
        await page.clock.install();
        await quickAction(page, "alpha", interest);
        await revealNativeMenu(page, "alpha");
        await page.clock.fastForward(2000);
        assert.equal(
          await page.locator("#alpha").getAttribute("data-selection"),
          null,
        );
        await page
          .getByRole("menuitem", { name: interest, exact: true })
          .click();
        assert.equal(
          await page.locator("#alpha").getAttribute("data-selection"),
          "interest:/watch?v=abcdefghijk",
        );
      },
      { host, menu: { delayed: true, linkToCard: false } },
    ));

  void test(`${host} hiding a thumbnail also hides its quick feedback buttons until restored`, () =>
    fixture(
      async (page) => {
        const target = page.locator("#alpha");
        const link = target.getByRole("link");
        await link.focus();
        const button = target.getByRole("button", {
          name: interest,
          exact: true,
        });
        await button.focus();
        await link.evaluate((element) => element.setAttribute("hidden", ""));
        await button.waitFor({ state: "hidden", timeout: 700 });
        await target
          .locator("a")
          .evaluate((element) => element.removeAttribute("hidden"));
        await link.focus();
        await button.waitFor();
      },
      { host },
    ));

  void test(`${host} a second trusted feedback click cannot claim the first card's delayed menu`, () =>
    fixture(
      async (page) => {
        const alpha = page.locator("#alpha");
        const beta = page.locator("#beta");
        await quickAction(page, "alpha", interest);
        assert.equal(await alpha.getAttribute("data-menu-opens"), "1");
        await quickAction(page, "beta", channel);
        await revealNativeMenu(page, "alpha");
        assert.equal(
          await alpha.getAttribute("data-selection"),
          "interest:/watch?v=abcdefghijk",
          "The first popup must use the first requested action",
        );
        assert.equal(
          await beta.getAttribute("data-menu-opens"),
          null,
          "No second native menu may open while the first is pending",
        );
        assert.equal(await beta.getAttribute("data-selection"), null);
        await quickAction(page, "beta", channel);
        await revealNativeMenu(page, "beta");
        assert.equal(
          await beta.getAttribute("data-selection"),
          "channel:/watch?v=lmnopqrstuv",
        );
      },
      {
        host,
        contents: card("alpha", "abcdefghijk") + card("beta", "lmnopqrstuv"),
        menu: { delayed: true },
      },
    ));

  void test(`${host} feedback excludes the History renderer on a recommendation URL during SPA navigation`, () => {
    const browse = host === "m.youtube.com" ? "ytm-browse" : "ytd-browse";
    const contents = `<${browse} id="stale" page-subtype="history">${card("alpha", "abcdefghijk")}</${browse}><${browse} page-subtype="home">${card("beta", "lmnopqrstuv")}</${browse}>`;
    return fixture(
      async (page) => {
        await page.locator("#alpha").getByRole("link").focus();
        assert.equal(
          await page
            .locator("#alpha")
            .getByRole("button", { name: interest, exact: true })
            .count(),
          0,
        );
        await page.locator("#beta").getByRole("link").focus();
        assert.equal(
          await page
            .locator("#beta")
            .getByRole("button", { name: interest, exact: true })
            .count(),
          1,
        );
        await page
          .locator("#stale")
          .evaluate((element) =>
            element.append(
              document.querySelector("#beta") ?? document.createElement("span"),
            ),
          );
        await page.locator("#beta").getByRole("link").focus();
        assert.equal(
          await page
            .locator("#beta")
            .getByRole("button", { name: interest, exact: true })
            .count(),
          0,
        );
      },
      { host, contents },
    );
  });
}

const watchedCard = `<ytm-browse page-subtype="home">${card(
  "alpha",
  "abcdefghijk",
).replace(
  "</a>",
  '<yt-thumbnail-overlay-progress-bar-view-model><div class="ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment" style="width:40%"></div></yt-thumbnail-overlay-progress-bar-view-model></a>',
)}</ytm-browse>`;

void test("mobile feedback rejects a popup with a native row belonging to another card", () =>
  fixture(
    async (page) => {
      await quickAction(page, "alpha", channel);
      await revealNativeMenu(page, "alpha");
      assert.equal(
        await page.locator("#beta").getAttribute("data-selection"),
        null,
      );
      assert.equal(
        await page.locator("#alpha").getAttribute("data-native-clicks"),
        null,
      );
    },
    {
      host: "m.youtube.com",
      contents: card("alpha", "abcdefghijk") + card("beta", "lmnopqrstuv"),
      menu: { delayed: true, conflictingRow: true },
    },
  ));

void test("mobile Mix feedback identifies the native row even when its feedback token is private", () =>
  fixture(
    async (page) => {
      const alpha = page.locator("#alpha");
      const beta = page.locator("#beta");
      await beta.locator(".fixture-trigger").click();
      await quickAction(page, "alpha", interest);
      await revealNativeMenu(page, "beta");
      assert.equal(await beta.getAttribute("data-selection"), null);
      await revealNativeMenu(page, "alpha");
      assert.equal(
        await alpha.getAttribute("data-selection"),
        "interest:/watch?v=abcdefghijk",
      );
      assert.equal(await beta.getAttribute("data-selection"), null);
      assert.equal(
        await page.locator('[data-target-id^="ytt-feedback-"]').count(),
        0,
      );
      await alpha.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(await alpha.getByRole("link").isVisible(), true);
      assert.equal(
        await alpha.locator("button-view-model").evaluate((button) => {
          let current: unknown = button;
          for (const key of [
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
            "0",
            "listItemViewModel",
          ]) {
            if (!current || typeof current !== "object")
              throw new Error("Missing native menu model");
            const value: unknown = Reflect.get(current, key);
            current = value;
          }
          if (!current || typeof current !== "object")
            throw new Error("Missing native menu row");
          return Object.hasOwn(current, "targetId");
        }),
        false,
      );
    },
    {
      host: "m.youtube.com",
      contents:
        card("alpha", "abcdefghijk").replace(
          '<img alt="alpha">',
          '<yt-collection-thumbnail-view-model><img alt="alpha"></yt-collection-thumbnail-view-model>',
        ) + card("beta", "lmnopqrstuv"),
      menu: { delayed: true, rows: [{ key: "interest", label: interest }] },
    },
  ));

void test("mobile feedback is available when another tab reveals a watched card", () =>
  fixture(
    async (page) => {
      const video = page.locator("#alpha");
      const thumbnail = video.getByRole("link");
      const feedback = video.getByRole("button", {
        name: interest,
        exact: true,
      });
      assert.equal(await thumbnail.isVisible(), false);
      await preference(page, "showWatched", true);
      await thumbnail.waitFor();
      await feedback.waitFor({ timeout: 1500 });
      await preference(page, "showWatched", false);
      await thumbnail.waitFor({ state: "hidden" });
      await preference(page, "showWatched", true);
      await feedback.waitFor({ timeout: 1500 });
    },
    { host: "m.youtube.com", contents: watchedCard },
  ));

void test("mobile feedback is available when YouTube clears a progress marker on a recycled card", () =>
  fixture(
    async (page) => {
      const video = page.locator("#alpha");
      const thumbnail = video.getByRole("link");
      assert.equal(await thumbnail.isVisible(), false);
      await video
        .locator(".ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment")
        .evaluate((node) => {
          if (!(node instanceof HTMLElement))
            throw new Error("Missing progress marker");
          node.style.width = "0%";
        });
      await thumbnail.waitFor();
      await video
        .getByRole("button", { name: interest, exact: true })
        .waitFor({ timeout: 1500 });
    },
    { host: "m.youtube.com", contents: watchedCard },
  ));

void test("a batch of feedback overlays measures all thumbnails before positioning any controls", () =>
  fixture(
    async (page) => {
      const count = 40;
      const markup = Array.from({ length: count }, (_, index) =>
        card(`video-${index}`, "abcdefghijk"),
      ).join("");
      await page.evaluate((cards) => {
        const measured = new WeakSet<Element>();
        const observations: { mounted: number; positioned: number }[] = [];
        let reads = 0;
        const measure: unknown = Reflect.get(
          Element.prototype,
          "getBoundingClientRect",
        );
        if (typeof measure !== "function")
          throw new Error("Missing native layout read");
        Element.prototype.getBoundingClientRect = function (
          this: Element,
        ): DOMRect {
          if (this.classList.contains("ytt-feedback-thumbnail")) {
            reads++;
            if (!measured.has(this)) {
              measured.add(this);
              const panels = [
                ...document.querySelectorAll<HTMLElement>(".ytt-feedback"),
              ];
              observations.push({
                mounted: panels.length,
                positioned: panels.filter((panel) => panel.style.left !== "")
                  .length,
              });
            }
          }
          const box: unknown = Reflect.apply(measure, this, []);
          if (!(box instanceof DOMRect))
            throw new Error("Missing native layout rectangle");
          return box;
        };
        Reflect.set(window, "readFirstFeedbackLayouts", () => observations);
        Reflect.set(window, "readFeedbackLayoutCount", () => reads);
        document
          .querySelector("ytm-page-manager")
          ?.insertAdjacentHTML("beforeend", cards);
      }, markup);
      await page.waitForFunction(
        (count) =>
          [...document.querySelectorAll<HTMLElement>(".ytt-feedback")].filter(
            (panel) => panel.style.left !== "",
          ).length === count,
        count,
      );
      const observations = await page.evaluate(() => {
        const read: unknown = Reflect.get(window, "readFirstFeedbackLayouts");
        if (typeof read !== "function")
          throw new Error("Missing layout observations");
        const result: unknown = Reflect.apply(read, window, []);
        return result;
      });
      assert.deepEqual(
        observations,
        Array.from({ length: count }, () => ({
          mounted: count,
          positioned: 0,
        })),
      );
      const counts = await page.evaluate(async () => {
        const read: unknown = Reflect.get(window, "readFeedbackLayoutCount");
        if (typeof read !== "function")
          throw new Error("Missing layout read count");
        const nextFrame = (): Promise<void> =>
          new Promise((resolve) =>
            window.requestAnimationFrame(() => resolve()),
          );
        await nextFrame();
        await nextFrame();
        const before: unknown = Reflect.apply(read, window, []);
        window.dispatchEvent(new Event("updateui"));
        await nextFrame();
        await nextFrame();
        const after: unknown = Reflect.apply(read, window, []);
        return { before, after };
      });
      assert.deepEqual(
        counts.after,
        counts.before,
        "Unchanged updateui must not reread layout for existing cards",
      );
    },
    { host: "m.youtube.com", contents: "" },
  ));

void test("desktop feedback stays inside the page manager when the surrounding shell adds a video", () =>
  fixture(async (page) => {
    await page
      .locator("ytd-app")
      .evaluate(
        (element, markup) => element.insertAdjacentHTML("beforeend", markup),
        card("outside", "lmnopqrstuv"),
      );
    const outside = page.locator("#outside");
    await outside.getByRole("link").focus();
    assert.equal(
      await outside
        .getByRole("button", { name: interest, exact: true })
        .count(),
      0,
    );
    await quickAction(page, "alpha", interest);
    assert.equal(
      await page.locator("#alpha").getAttribute("data-selection"),
      "interest:/watch?v=abcdefghijk",
    );
  }));

void test("desktop feedback waits for a page manager that mounts after the shell", () =>
  fixture(
    async (page) => {
      const shell = page.locator("#outside");
      await shell.getByRole("link").focus();
      assert.equal(
        await shell
          .getByRole("button", { name: interest, exact: true })
          .count(),
        0,
      );
      await page
        .locator("#content")
        .evaluate(
          (content, markup) => content.insertAdjacentHTML("beforeend", markup),
          `<ytd-page-manager id="page-manager">${card("alpha", "abcdefghijk")}</ytd-page-manager>`,
        );
      const video = page.locator("#alpha");
      await video.getByRole("link").focus();
      await video
        .getByRole("button", { name: interest, exact: true })
        .waitFor({ timeout: 1500 });
      await shell.getByRole("link").focus();
      assert.equal(
        await shell
          .getByRole("button", { name: interest, exact: true })
          .count(),
        0,
      );
    },
    {
      contents: `<div id="content">${card("outside", "lmnopqrstuv")}</div>`,
      pageManager: false,
    },
  ));

void test("desktop feedback follows a replacement page manager and detaches its old controls", () =>
  fixture(async (page) => {
    await page.locator("ytd-page-manager").evaluate(
      (old, markup) => {
        const parent = old.parentElement;
        if (!parent) throw new Error("Missing YouTube app");
        parent.insertAdjacentHTML("beforeend", markup);
        const shell = parent.querySelector("#detached");
        if (!shell) throw new Error("Missing shell container");
        shell.append(old);
        old.replaceWith(...old.childNodes);
      },
      `<div id="content"><ytd-page-manager id="page-manager">${card("beta", "lmnopqrstuv")}</ytd-page-manager></div><div id="detached"></div>`,
    );
    const video = page.locator("#beta");
    await video.getByRole("link").focus();
    await video
      .getByRole("button", { name: interest, exact: true })
      .waitFor({ timeout: 1500 });
    const detached = page.locator("#alpha");
    await detached.getByRole("link").focus();
    assert.equal(
      await detached
        .getByRole("button", { name: interest, exact: true })
        .count(),
      0,
    );
  }));

void test("legacy rich renderer delegates feedback without a nested lockup", () =>
  fixture(
    async (page) => {
      await quickAction(page, "alpha", interest);
      assert.equal(
        await page.locator("#alpha").getAttribute("data-selection"),
        "interest:/watch?v=abcdefghijk",
      );
    },
    { contents: card("alpha", "abcdefghijk", "ytd-rich-item-renderer") },
  ));

for (const [state, properties] of [
  ["aria-disabled button", { attributes: 'aria-disabled="true"' }],
  ["aria-disabled renderer", { rowAttributes: 'aria-disabled="true"' }],
  ["disabled button", { attributes: "disabled" }],
] as const) {
  void test(`feedback reports an unavailable action from an ${state}`, () =>
    fixture(
      async (page) => {
        await quickAction(page, "alpha", interest);
        const target = page.locator("#alpha");
        assert.equal(await target.getAttribute("data-selection"), null);
        await target
          .getByRole("button", { name: "Unavailable", exact: true })
          .waitFor();
        assert.equal(await target.getByRole("link").isVisible(), true);
        assert.equal(await page.getByRole("menu").count(), 0);
      },
      {
        menu: {
          rows: [
            {
              key: "interest",
              label: interest,
              icon: interestIcon,
              ...properties,
            },
            { key: "channel", label: channel },
          ],
        },
      },
    ));
}

void test("native Undo restores usable feedback on the same thumbnail", () =>
  fixture(async (page) => {
    const target = page.locator("#alpha");
    await quickAction(page, "alpha", interest);
    assert.equal(
      await target.getAttribute("data-selection"),
      "interest:/watch?v=abcdefghijk",
    );
    assert.equal(await target.getByRole("link").count(), 0);
    await target.getByRole("button", { name: "Undo", exact: true }).click();
    await quickAction(page, "alpha", channel);
    assert.equal(
      await target.getAttribute("data-selection"),
      "channel:/watch?v=abcdefghijk",
    );
  }));

void test("a trusted click outside feedback cancels selection from a delayed native menu", () =>
  fixture(
    async (page) => {
      await quickAction(page, "alpha", interest);
      await page.getByRole("button", { name: "Outside", exact: true }).click();
      await revealNativeMenu(page, "alpha");
      assert.equal(
        await page.locator("#alpha").getAttribute("data-selection"),
        null,
      );
      assert.equal(
        await page.locator("#alpha").getByRole("link").isVisible(),
        true,
      );
    },
    { menu: { delayed: true } },
  ));

void test("a native menu arriving after feedback has timed out cannot select an action", () =>
  fixture(
    async (page) => {
      await page.clock.install();
      await quickAction(page, "alpha", interest);
      await page.clock.fastForward(10_000);
      await revealNativeMenu(page, "alpha");
      assert.equal(
        await page.locator("#alpha").getAttribute("data-selection"),
        null,
      );
      assert.equal(
        await page.locator("#alpha").getByRole("link").isVisible(),
        true,
      );
    },
    { menu: { delayed: true } },
  ));

void test("a delayed native menu cannot select feedback after a round trip through SPA navigation", () =>
  fixture(
    async (page) => {
      await quickAction(page, "alpha", interest);
      await page.evaluate(() => {
        const from = location.href;
        history.pushState({}, "", "/results?search_query=example");
        document.dispatchEvent(new Event("yt-navigate-finish"));
        history.pushState({}, "", from);
        document.dispatchEvent(new Event("yt-navigate-finish"));
      });
      await revealNativeMenu(page, "alpha");
      assert.equal(
        await page.locator("#alpha").getAttribute("data-selection"),
        null,
      );
      assert.equal(
        await page.locator("#alpha").getByRole("link").isVisible(),
        true,
      );
    },
    { menu: { delayed: true } },
  ));

void test("a delayed native menu cannot select feedback on a recycled thumbnail with its original URL restored", () =>
  fixture(
    async (page) => {
      await quickAction(page, "alpha", interest);
      const link = page.locator("#alpha").getByRole("link");
      await link.evaluate((element) =>
        element.setAttribute("href", "/watch?v=lmnopqrstuv"),
      );
      await link.evaluate((element) =>
        element.setAttribute("href", "/watch?v=abcdefghijk"),
      );
      await revealNativeMenu(page, "alpha");
      assert.equal(
        await page.locator("#alpha").getAttribute("data-selection"),
        null,
      );
      assert.equal(await link.isVisible(), true);
    },
    { menu: { delayed: true } },
  ));

for (const locale of translations) {
  const overrides = nativeLabels[locale.language];
  const rows = [
    { key: "channel", label: overrides?.channel ?? locale.channel },
    { key: "other", label: "Watch later" },
    { key: "interest", label: overrides?.interest ?? locale.interest },
  ];
  void test(`quick feedback invokes the labeled native actions in ${locale.language || "the default language"}`, () =>
    fixture(
      async (page) => {
        const target = page.locator("#alpha");
        await quickAction(page, "alpha", locale.interest);
        assert.equal(
          await target.getAttribute("data-selection"),
          "interest:/watch?v=abcdefghijk",
          `Native label: ${rows[2]?.label}`,
        );
        await target.getByRole("button", { name: "Undo", exact: true }).click();
        await quickAction(page, "alpha", locale.channel);
        assert.equal(
          await target.getAttribute("data-selection"),
          "channel:/watch?v=abcdefghijk",
          `Native label: ${rows[0]?.label}`,
        );
      },
      { language: locale.language, rtl: "direction" in locale, menu: { rows } },
    ));
}

void test("feedback recognizes a native icon with an unrecognized non-English label", () =>
  fixture(
    async (page) => {
      await quickAction(page, "alpha", "チャンネルをおすすめに表示しない");
      assert.equal(
        await page.locator("#alpha").getAttribute("data-selection"),
        "channel:/watch?v=abcdefghijk",
      );
    },
    {
      language: "ja-JP",
      menu: {
        rows: [
          { key: "interest", label: "興味がない", icon: interestIcon },
          {
            key: "channel",
            label: "このチャンネルを表示しない",
            icon: channelIcon,
          },
        ],
      },
    },
  ));
