import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import type { Page, Worker } from 'playwright';
import { candidate, hosts, openYouTube, optionsFor, play, playback } from '../harness.ts';
import type { Host } from '../harness.ts';
import { guestPlaybackSkip } from './guest-playback.ts';

const sponsorVideo = 'se9HT9At0fI';
const tailVideo = 'rPA_nqPHjXo';

async function sponsorRange(video: string, category: 'sponsor' | 'outro'): Promise<{ start: number; end: number }> {
  const url = new URL('https://sponsor.ajay.app/api/skipSegments');
  url.searchParams.set('videoID', video);
  url.searchParams.set('category', category);
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  assert.ok(response.ok, `SponsorBlock segment API returned ${response.status}`);
  const body: unknown = await response.json();
  assert.ok(Array.isArray(body));
  const entries: unknown[] = body;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !('segment' in entry) || !Array.isArray(entry.segment)) continue;
    const start: unknown = entry.segment[0];
    const end: unknown = entry.segment[1];
    if (typeof start === 'number' && typeof end === 'number' && start > 5 && end - start > 6) return { start, end };
  }
  throw new Error('A usable public sponsor segment is required');
}

async function configure(worker: Worker, option: 1 | 2, category: 'sponsor' | 'outro'): Promise<void> {
  await worker.evaluate(async selection => {
    const api: unknown = Reflect.get(globalThis, 'chrome');
    if (!api || typeof api !== 'object' || !('storage' in api) || !api.storage || typeof api.storage !== 'object' ||
        !('sync' in api.storage) || !api.storage.sync || typeof api.storage.sync !== 'object' ||
        !('set' in api.storage.sync) || typeof api.storage.sync.set !== 'function') throw new Error('The official SponsorBlock extension storage is unavailable');
    await Reflect.apply(api.storage.sync.set, api.storage.sync, [{
      categorySelections: [selection],
      dontShowNotice: false,
      skipNoticeDuration: 16,
      trackViewCount: false,
    }]);
  }, { name: category, option });
}

async function withSponsor(host: Host, option: 1 | 2, category: 'sponsor' | 'outro', run: (page: Page) => Promise<void>): Promise<void> {
  const extension = process.env.SPONSORBLOCK_EXTENSION;
  assert.ok(extension, 'The official SponsorBlock package must be unpacked and verified');
  const context = await chromium.launchPersistentContext('', {
    ...optionsFor(host),
    channel: 'chromium',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--mute-audio'],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 12000 });
    await configure(worker, option, category);
    await candidate(context, { audioOnly: true });
    await run(await context.newPage());
  } finally {
    await context.close();
  }
}

for (const host of hosts) {
  for (const mode of ['automatic', 'manual'] as const) void test(`${host} SponsorBlock can ${mode === 'automatic' ? 'auto-skip' : 'manually skip'} a public segment and undo it in audio-only mode`, { timeout: 100000, skip: guestPlaybackSkip(host) }, async () => {
    const range = await sponsorRange(sponsorVideo, 'sponsor');
    await withSponsor(host, mode === 'automatic' ? 2 : 1, 'sponsor', async page => {
      await openYouTube(page, host, `/watch?v=${sponsorVideo}`);
      await play(page);
      await playback(page, 'audio');
      const media = page.locator('#movie_player video').first();
      await media.evaluate((element, start) => {
        if (!(element instanceof HTMLVideoElement)) throw new Error('Native YouTube media is absent');
        element.currentTime = start - 0.75;
      }, range.start);
      const button = page.locator('.sponsorSkipNoticeContainer button[id^="sponsorSkipUnskipButton"]:visible').first();
      if (mode === 'manual') {
        await button.waitFor({ timeout: 5000 });
        const time = await media.evaluate(element => element instanceof HTMLVideoElement ? element.currentTime : -1);
        assert.ok(time >= range.start - 0.25 && time < range.end - 1);
        await button.click();
      }
      await page.waitForFunction(end => (document.querySelector<HTMLVideoElement>('#movie_player video')?.currentTime ?? 0) >= end - 0.15, range.end, { timeout: 4500 });
      await button.click();
      await page.waitForFunction(({ start, end }) => {
        const clock = document.querySelector<HTMLVideoElement>('#movie_player video')?.currentTime ?? -1;
        return clock >= start - 1 && clock < end - 1;
      }, range, { timeout: 3000 });
      await playback(page, 'audio');
    });
  });

  void test(`${host} SponsorBlock can skip through the end of a real Mix, then follow native Next in the same page`, { timeout: 110000, skip: guestPlaybackSkip(host) }, async () => {
    const range = await sponsorRange(tailVideo, 'outro');
    const list = `RD${tailVideo}`;
    await withSponsor(host, 2, 'outro', async page => {
      await openYouTube(page, host, `/watch?v=${tailVideo}&list=${list}`);
      await play(page);
      await page.waitForFunction(end => {
        const player = document.querySelector('#movie_player');
        const media = player?.querySelector('video');
        return !player?.classList.contains('ad-showing') && !!media &&
          media.readyState >= 3 && Math.abs(media.duration - end) <= 0.5;
      }, range.end, { timeout: 26000 });
      await playback(page, 'audio');
      const beginning = await page.evaluate(() => performance.timeOrigin);
      const media = page.locator('#movie_player video').first();
      await media.evaluate((element, start) => {
        if (!(element instanceof HTMLVideoElement)) throw new Error('Native YouTube media is absent');
        element.currentTime = start - 0.75;
      }, range.start);
      await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#movie_player video')?.ended, undefined, { timeout: 7500 });
      assert.equal(new URL(page.url()).searchParams.get('v'), tailVideo);
      const next = host === 'm.youtube.com' ? page.getByRole('button', { name: 'Next video', exact: true }) : page.locator('#movie_player .ytp-next-button');
      await next.first().evaluate(control => {
        if (!(control instanceof HTMLElement) || control.getAttribute('aria-disabled') === 'true') throw new Error('Native playlist Next is unavailable');
        control.click();
      });
      await page.waitForURL(url => url.searchParams.get('v') !== tailVideo && url.searchParams.get('list') === list, { timeout: 12000 });
      assert.equal(await page.evaluate(() => performance.timeOrigin), beginning);
      await play(page);
      await playback(page, 'audio');
      await page.locator('#sbSkipIconControlBarImage').first().waitFor({ state: 'attached', timeout: 12000 });
    });
  });
}
