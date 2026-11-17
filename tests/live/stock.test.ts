import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import {
  freshPage,
  hosts,
  openYouTube,
  play,
  playback,
  playlist,
  playlistPath,
  seekNearEnd,
} from "../harness.ts";
import { recordGuestPlaybackBlock } from "./guest-playback.ts";

let browser: Browser;
before(async () => {
  browser = await chromium.launch({
    args: ["--disable-extensions", "--mute-audio"],
  });
});
after(async () => {
  await browser?.close();
});

for (const host of hosts) {
  void test(
    `${host} real guest search renders a native card and action control without extensions`,
    { timeout: 45000 },
    async () => {
      await freshPage(browser, host, async (page) => {
        await openYouTube(page, host, "/results?search_query=YouTube+Creators");
        const card = page
          .locator(
            host === "m.youtube.com"
              ? "ytm-video-with-context-renderer"
              : "ytd-video-renderer",
          )
          .filter({ has: page.locator('a[href^="/watch?v="]') })
          .first();
        await card.waitFor({ timeout: 13000 });
        assert.equal(
          await page
            .locator(".ytt-action,.ytt-setting,#sbSkipIconControlBarImage")
            .count(),
          0,
        );
        const more = card
          .locator(
            'ytd-menu-renderer button,ytm-menu button,button[aria-label="Action menu"],button[aria-label="More actions"],button[aria-label="More"]',
          )
          .first();
        await more.waitFor({ timeout: 6500 });
        assert.ok(await more.isEnabled());
        const href = await card
          .locator('a[href^="/watch?v="]')
          .first()
          .getAttribute("href");
        assert.ok(href && new URL(href, page.url()).searchParams.get("v"));
      });
    },
  );

  void test(
    `${host} real guest playlist decodes video and auto-advances on stock YouTube`,
    { timeout: 65000 },
    async (t) => {
      await freshPage(browser, host, async (page) => {
        await openYouTube(page, host, playlistPath());
        assert.equal(
          await page.locator("#previewbar,#sbSkipIconControlBarImage").count(),
          0,
        );
        try {
          await play(page);
          await playback(page, "video");
        } catch (error) {
          const watchUrl = new URL(page.url());
          if (
            watchUrl.hostname !== host ||
            watchUrl.pathname !== "/watch" ||
            watchUrl.searchParams.get("v") !== playlist.first
          )
            throw error;
          const statuses = await page.evaluate(() => {
            const player = document.querySelector("#movie_player");
            const getResponse: unknown =
              player && Reflect.get(player, "getPlayerResponse");
            const response: unknown =
              typeof getResponse === "function"
                ? Reflect.apply(getResponse, player, [])
                : null;
            const initial: unknown = Reflect.get(
              window,
              "ytInitialPlayerResponse",
            );
            return [response, initial].map((value) => {
              if (value === null || value === undefined) return null;
              if (typeof value !== "object" || !("playabilityStatus" in value))
                return {};
              const status = value.playabilityStatus;
              if (
                !status ||
                typeof status !== "object" ||
                !("status" in status) ||
                typeof status.status !== "string"
              )
                return {};
              const reason =
                "reason" in status && typeof status.reason === "string"
                  ? status.reason
                  : undefined;
              return { status: status.status, reason };
            });
          });
          const reason = await recordGuestPlaybackBlock(host, statuses);
          if (!reason) throw error;
          t.skip(reason);
          return;
        }
        const documentStart = await page.evaluate(() => performance.timeOrigin);
        await seekNearEnd(page);
        await page.waitForURL(
          (url) =>
            url.searchParams.get("v") === playlist.next &&
            url.searchParams.get("list") === playlist.id,
          { timeout: 12000 },
        );
        assert.equal(
          await page.evaluate(() => performance.timeOrigin),
          documentStart,
        );
      });
    },
  );
}
