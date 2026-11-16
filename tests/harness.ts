import { readFile } from 'node:fs/promises';
import { devices } from 'playwright';
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';

export const hosts = ['www.youtube.com', 'm.youtube.com'] as const;
export type Host = typeof hosts[number];
export const playlist = {
  id: 'PLpjK416fmKwRaSyhTwKexEzhZSjDJdV0G',
  first: 'aKydtOXW8mI',
  next: 'WTXrn6y2cFU',
  ordinaryAfterPreload: 'IvQkb8aHPu8',
  audioAfterPreload: 'om2WiDsHLso',
};

type Preferences = { showWatched?: boolean; audioOnly?: boolean };

export function appTag(host: Host): string {
  return host === 'm.youtube.com' ? 'ytm-app' : 'ytd-app';
}

export function optionsFor(host: Host): BrowserContextOptions {
  return { ...(host === 'm.youtube.com' ? devices['Pixel 7'] : {}), locale: 'en-US' };
}

export function urlFor(host: Host, path: string, language = 'en'): URL {
  const url = new URL(path, `https://${host}`);
  if (host === 'm.youtube.com') url.searchParams.set('app', 'm');
  url.searchParams.set('hl', language);
  return url;
}

export async function openYouTube(page: Page, host: Host, path: string, language = 'en'): Promise<void> {
  await page.goto(urlFor(host, path, language).href, { waitUntil: 'domcontentloaded', timeout: 25000 });
  const reject = page.getByRole('button', { name: 'Reject all', exact: true }).first();
  if (await reject.isVisible()) await reject.click();
  if (new URL(page.url()).hostname !== host) throw new Error(`Expected ${host}; opened ${new URL(page.url()).hostname}`);
  await page.locator(appTag(host)).first().waitFor({ state: 'attached', timeout: 12000 });
}

export async function freshPage(browser: Browser, host: Host, run: (page: Page, context: BrowserContext) => Promise<void>, options: BrowserContextOptions = {}): Promise<void> {
  const context = await browser.newContext({ ...optionsFor(host), ...options });
  try {
    await run(await context.newPage(), context);
  } finally {
    await context.close();
  }
}

function gmForTest(initial: Preferences): void {
  const values = new Map<string, boolean>(Object.entries(initial));
  const prefix = 'youtube-tools-spec:';
  type Callback = (name: string, oldValue: boolean | undefined, value: boolean, remote: boolean) => void;
  const listeners = new Map<string, Set<Callback>>();

  function read(name: string): boolean | undefined {
    const stored = localStorage.getItem(prefix + name);
    return stored === null ? values.get(name) : stored === 'true';
  }

  function save(name: string, value: boolean, remote: boolean): void {
    const before = read(name);
    localStorage.setItem(prefix + name, String(value));
    for (const run of listeners.get(name) ?? []) run(name, before, value, remote);
  }

  Object.defineProperties(window, {
    unsafeWindow: { value: window },
    GM_getValue: { value: (name: string, fallback: unknown) => read(name) ?? fallback },
    GM_setValue: { value: (name: string, value: boolean) => {
      save(name, value, false);
      document.dispatchEvent(new CustomEvent('spec-local-preference', { detail: { name, value } }));
    } },
    GM_addValueChangeListener: { value: (name: string, listener: Callback) => {
      const handlers = listeners.get(name) ?? new Set<Callback>();
      handlers.add(listener);
      listeners.set(name, handlers);
      return String(handlers.size);
    } },
    GM_addStyle: { value: (css: string) => {
      const style = document.createElement('style');
      style.textContent = css;
      if (document.documentElement) (document.head ?? document.documentElement).append(style);
      else document.addEventListener('DOMContentLoaded', () => document.head.append(style), { once: true });
      return style;
    } },
  });

  document.addEventListener('spec-remote-preference', event => {
    if (!(event instanceof CustomEvent)) return;
    const data: unknown = event.detail;
    if (data && typeof data === 'object' && 'name' in data && 'value' in data &&
        typeof data.name === 'string' && typeof data.value === 'boolean') save(data.name, data.value, true);
  });
}

export async function candidate(context: BrowserContext, initial: Preferences = {}): Promise<void> {
  let code = '';
  const artifact = process.env.YOUTUBE_TOOLS_ARTIFACT === 'youtube-tools.debug.js' ? 'youtube-tools.debug.js' : 'youtube-tools.user.js';
  try {
    code = await readFile(new URL(`../${artifact}`, import.meta.url), 'utf8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  await context.addInitScript({ content: `if (/^(?:www|m)\\.youtube\\.com$/.test(location.hostname)) {(${gmForTest.toString()})(${JSON.stringify(initial)});\n${code}\n}` });
}

export async function preference(page: Page, name: keyof Preferences, value: boolean): Promise<void> {
  await page.evaluate(detail => document.dispatchEvent(new CustomEvent('spec-remote-preference', { detail })), { name, value });
}

export async function play(page: Page): Promise<void> {
  const media = page.locator('#movie_player video').first();
  await media.waitFor({ state: 'attached', timeout: 15000 });
  await media.evaluate(async element => {
    if (!(element instanceof HTMLVideoElement)) throw new Error('Native YouTube video is absent');
    element.muted = true;
    let timer: number | undefined;
    try {
      await Promise.race([element.play(), new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(() => {
          const reason = document.querySelector('.ytp-error,yt-playability-error-supported-renderers')?.textContent?.trim();
          reject(new Error(reason ? `YouTube playback: ${reason}` : `YouTube playback did not start (readyState=${element.readyState})`));
        }, 10000);
      })]);
    } finally {
      window.clearTimeout(timer);
    }
  }, undefined, { timeout: 14000 });
}

export function playlistPath(): string {
  return `/watch?v=${playlist.first}&list=${playlist.id}`;
}

export async function playback(page: Page, mode: 'video' | 'audio'): Promise<void> {
  await page.waitForFunction(expected => {
    const video = document.querySelector<HTMLVideoElement>('#movie_player video');
    if (!video || video.currentTime <= 1) return false;
    const bytes: unknown = Reflect.get(video, 'webkitAudioDecodedByteCount');
    const frames = video.getVideoPlaybackQuality().totalVideoFrames;
    if (typeof bytes !== 'number' || bytes <= 0) return false;
    return expected === 'audio' ? frames === 0 && video.videoWidth === 0 : frames > 0 && video.videoWidth > 0;
  }, mode, { timeout: 15000 });
}

export async function seekNearEnd(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('#movie_player video');
    return video && Number.isFinite(video.duration) && video.duration > 1 && video.currentTime > 0.2;
  }, undefined, { timeout: 12000 });
  await page.locator('#movie_player video').first().evaluate(element => {
    if (!(element instanceof HTMLVideoElement)) throw new Error('Native YouTube video is absent');
    element.currentTime = element.duration - 0.35;
  });
}
