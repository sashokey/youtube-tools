import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { freshPage, hosts, openYouTube, play, playback, playlist, playlistPath, seekNearEnd } from '../harness.ts';

let browser: Browser;
before(async () => { browser = await chromium.launch({ args: ['--disable-extensions', '--mute-audio'] }); });
after(async () => { await browser?.close(); });

for (const host of hosts) {
  void test(`${host} real guest search renders a native card and menu without extensions`, { timeout: 50000 }, async () => {
    await freshPage(browser, host, async page => {
      await openYouTube(page, host, '/results?search_query=YouTube+Creators');
      const card = page.locator(host === 'm.youtube.com' ? 'ytm-video-with-context-renderer' : 'ytd-video-renderer')
        .filter({ has: page.locator('a[href^="/watch?v="]') }).first();
      await card.waitFor({ timeout: 13000 });
      assert.equal(await page.locator('.ytt-action,.ytt-setting,#sbSkipIconControlBarImage').count(), 0);
      const more = card.locator('ytd-menu-renderer button,ytm-menu button,button[aria-label="Action menu"],button[aria-label="More actions"],button[aria-label="More"]').first();
      await more.click({ timeout: 6500 });
      const menu = page.locator('ytd-menu-popup-renderer:visible,ytm-menu-popup-renderer:visible,yt-sheet-view-model:visible').first();
      await menu.waitFor({ timeout: 6500 });
      assert.ok(await menu.getByRole('menuitem').count() > 0 || await menu.locator('button,ytd-menu-service-item-renderer,ytm-menu-service-item-renderer').count() > 0);
    });
  });

  void test(`${host} real guest playlist decodes video and auto-advances on stock YouTube`, { timeout: 65000 }, async () => {
    await freshPage(browser, host, async page => {
      await openYouTube(page, host, playlistPath());
      assert.equal(await page.locator('#previewbar,#sbSkipIconControlBarImage').count(), 0);
      await play(page);
      await playback(page, 'video');
      const documentStart = await page.evaluate(() => performance.timeOrigin);
      await seekNearEnd(page);
      await page.waitForURL(url => url.searchParams.get('v') === playlist.next && url.searchParams.get('list') === playlist.id, { timeout: 12000 });
      assert.equal(await page.evaluate(() => performance.timeOrigin), documentStart);
    });
  });
}
