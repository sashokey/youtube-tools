import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import type { Worker } from 'playwright';
import { candidate, hosts, openYouTube, optionsFor, play, playback } from '../harness.ts';

const sponsorVideo = 'se9HT9At0fI';

async function sponsorRange(): Promise<{ start: number; end: number }> {
  const url = new URL('https://sponsor.ajay.app/api/skipSegments');
  url.searchParams.set('videoID', sponsorVideo);
  url.searchParams.set('category', 'sponsor');
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

async function configure(worker: Worker, option: 1 | 2): Promise<void> {
  await worker.evaluate(async mode => {
    const api: unknown = Reflect.get(globalThis, 'chrome');
    if (!api || typeof api !== 'object' || !('storage' in api) || !api.storage || typeof api.storage !== 'object' ||
        !('sync' in api.storage) || !api.storage.sync || typeof api.storage.sync !== 'object' ||
        !('set' in api.storage.sync) || typeof api.storage.sync.set !== 'function') throw new Error('The official SponsorBlock extension storage is unavailable');
    await Reflect.apply(api.storage.sync.set, api.storage.sync, [{
      categorySelections: [{ name: 'sponsor', option: mode }],
      dontShowNotice: false,
      skipNoticeDuration: 16,
      trackViewCount: false,
    }]);
  }, option);
}

for (const host of hosts) for (const mode of ['automatic', 'manual'] as const) {
  void test(`${host} SponsorBlock can ${mode === 'automatic' ? 'auto-skip' : 'manually skip'} a public segment and undo it in audio-only mode`, { timeout: 100000 }, async () => {
    const extension = process.env.SPONSORBLOCK_EXTENSION;
    assert.ok(extension, 'The official SponsorBlock package must be unpacked and verified');
    const range = await sponsorRange();
    const context = await chromium.launchPersistentContext('', {
      ...optionsFor(host),
      channel: 'chromium',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--mute-audio'],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 12000 });
      await configure(worker, mode === 'automatic' ? 2 : 1);
      await candidate(context, { audioOnly: true });
      const page = await context.newPage();
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
    } finally {
      await context.close();
    }
  });
}
