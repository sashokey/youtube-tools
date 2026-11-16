import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { candidate, freshPage, hosts, openYouTube, play, playback, playlist, playlistPath, preference, seekNearEnd } from '../harness.ts';
import { guestPlaybackSkip } from './guest-playback.ts';

let browser: Browser;
before(async () => { browser = await chromium.launch({ args: ['--disable-extensions', '--mute-audio'] }); });
after(async () => { await browser?.close(); });

async function observeBuffers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const formats: string[] = [];
    const native: unknown = Reflect.get(MediaSource.prototype, 'addSourceBuffer');
    if (typeof native !== 'function') throw new Error('MediaSource cannot open a buffer');
    MediaSource.prototype.addSourceBuffer = function (format) {
      formats.push(format.split(';')[0] ?? format);
      const result: unknown = Reflect.apply(native, this, [format]);
      if (!(result instanceof SourceBuffer)) throw new Error('MediaSource returned an invalid buffer');
      return result;
    };
    Object.defineProperty(window, 'specMediaFormats', { value: formats });
  });
}

async function onlyAudioBuffers(page: Page): Promise<void> {
  const formats = await page.evaluate(() => {
    const value: unknown = Reflect.get(window, 'specMediaFormats');
    return Array.isArray(value) ? value.filter((x: unknown): x is string => typeof x === 'string') : [];
  });
  assert.ok(formats.some(x => x.startsWith('audio/')), 'The native player opened an audio buffer');
  assert.ok(formats.every(x => !x.startsWith('video/')), 'The native player opened no video buffer');
}

async function nativePlayerCall(page: Page, method: 'preloadVideoByPlayerVars' | 'loadVideoByPlayerVars', videoId: string): Promise<void> {
  await page.locator('#movie_player').evaluate((player, call) => {
    const fn: unknown = Reflect.get(player, call.method);
    if (typeof fn !== 'function') throw new Error(`Native ${call.method} is absent`);
    Reflect.apply(fn, player, [{ video_id: call.videoId, autoplay: call.method === 'loadVideoByPlayerVars' ? 1 : 0 }]);
  }, { method, videoId });
}

async function currentNativeVideo(page: Page, id: string): Promise<void> {
  await page.waitForFunction(expected => {
    const player = document.querySelector('#movie_player');
    if (!player) return false;
    const read: unknown = Reflect.get(player, 'getVideoData');
    if (typeof read !== 'function') return false;
    const data: unknown = Reflect.apply(read, player, []);
    return !!data && typeof data === 'object' && 'video_id' in data && data.video_id === expected;
  }, id, { timeout: 13000 });
}

for (const host of hosts) {
  void test(`${host} quick feedback overlays a real guest search card`, { timeout: 45000 }, async () => {
    await freshPage(browser, host, async (page, context) => {
      await candidate(context);
      await openYouTube(page, host, '/results?search_query=YouTube+Creators');
      const card = page.locator(host === 'm.youtube.com' ? 'ytm-video-with-context-renderer' : 'ytd-video-renderer')
        .filter({ has: page.locator('a[href^="/watch?v="]') }).first();
      await card.waitFor({ timeout: 13000 });
      if (host === 'www.youtube.com') await card.locator('a[href^="/watch?v="]').first().focus();
      assert.equal(await card.getByRole('button', { name: 'Not interested', exact: true }).count(), 1);
      assert.equal(await card.getByRole('button', { name: "Don't recommend channel", exact: true }).count(), 1);
    });
  });

  void test(`${host} real audio-only playback keeps the native element and opens no video buffer`, { timeout: 60000, skip: guestPlaybackSkip(host) }, async () => {
    await freshPage(browser, host, async (page, context) => {
      await candidate(context, { audioOnly: true });
      await observeBuffers(page);
      await openYouTube(page, host, playlistPath());
      await play(page);
      await playback(page, 'audio');
      await onlyAudioBuffers(page);
      assert.equal(await page.locator('#movie_player video.html5-main-video').count(), 1);
    });
  });

  void test(`${host} both audio-mode changes take effect after a native preload`, { timeout: 90000, skip: guestPlaybackSkip(host) }, async () => {
    await freshPage(browser, host, async (page, context) => {
      await candidate(context, { audioOnly: true });
      await openYouTube(page, host, playlistPath());
      await play(page);
      await playback(page, 'audio');
      const start = await page.evaluate(() => performance.timeOrigin);
      for (const [id, enabled] of [[playlist.ordinaryAfterPreload, false], [playlist.audioAfterPreload, true]] as const) {
        const preload = page.waitForRequest(request => request.url().includes('/youtubei/v1/player') && request.postData()?.includes(id) === true, { timeout: 12000 });
        await nativePlayerCall(page, 'preloadVideoByPlayerVars', id);
        await preload;
        await preference(page, 'audioOnly', enabled);
        await nativePlayerCall(page, 'loadVideoByPlayerVars', id);
        await play(page);
        await currentNativeVideo(page, id);
        await playback(page, enabled ? 'audio' : 'video');
        assert.equal(await page.evaluate(() => performance.timeOrigin), start);
      }
    });
  });

  void test(`${host} a real playlist stops at the end and keeps its native Next and Previous actions`, { timeout: 85000, skip: guestPlaybackSkip(host) }, async () => {
    await freshPage(browser, host, async (page, context) => {
      await candidate(context);
      await openYouTube(page, host, playlistPath());
      await play(page);
      await seekNearEnd(page);
      await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#movie_player video')?.ended, undefined, { timeout: 12000 });
      await page.waitForTimeout(7000);
      assert.equal(new URL(page.url()).searchParams.get('v'), playlist.first);
      const next = host === 'm.youtube.com' ? page.getByRole('button', { name: 'Next video', exact: true }) : page.locator('#movie_player .ytp-next-button');
      await next.click({ timeout: 8500 });
      await page.waitForURL(url => url.searchParams.get('v') === playlist.next, { timeout: 11000 });
      const previous = host === 'm.youtube.com' ? page.getByRole('button', { name: 'Previous video', exact: true }) : page.locator('#movie_player .ytp-prev-button');
      const video = page.locator('#movie_player video.html5-main-video').first();
      if (host === 'm.youtube.com' && !await previous.isVisible()) await video.click();
      await previous.click({ timeout: 8500 });
      await page.waitForURL(url => url.searchParams.get('v') === playlist.first, { timeout: 11000 });
    });
  });
}
