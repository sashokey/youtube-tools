import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

void test('audio changes reach the page global when Violentmonkey wraps window', async () => {
  const artifact = process.env.YOUTUBE_TOOLS_ARTIFACT === 'youtube-tools.debug.js' ? 'youtube-tools.debug.js' : 'youtube-tools.user.js';
  const code = await readFile(new URL(`../${artifact}`, import.meta.url), 'utf8');
  const wrappedWindow: Record<string, unknown> = { addEventListener() {} };
  const originalWindow: Record<string, unknown> = {};
  wrappedWindow['top'] = wrappedWindow;
  const listeners = new Map<string, (key: string, old: boolean, value: boolean) => void>();
  runInNewContext(code, {
    window: wrappedWindow,
    unsafeWindow: originalWindow,
    location: { hostname: 'www.youtube.com', pathname: '/watch', search: '' },
    document: { readyState: 'loading', addEventListener() {} },
    GM_getValue: (key: string) => key === 'audioOnly',
    GM_addValueChangeListener: (key: string, listener: (key: string, old: boolean, value: boolean) => void) => listeners.set(key, listener),
  });
  type Args = { video_id: string; audio_only?: boolean };
  const observed: (boolean | undefined)[] = [];
  const player = {
    preloadVideoByPlayerVars(value: Args) { observed.push(value.audio_only); },
    loadVideoByPlayerVars(value: Args) { observed.push(value.audio_only); },
  };
  const app = {
    create(_element: object, config: { args: Args }) {
      observed.push(config.args.audio_only);
      return player;
    },
  };
  originalWindow['yt'] = { player: { Application: app } };
  app.create({}, { args: { video_id: 'aKydtOXW8mI' } });
  player.preloadVideoByPlayerVars({ video_id: 'IvQkb8aHPu8' });
  listeners.get('audioOnly')?.('audioOnly', true, false);
  player.loadVideoByPlayerVars({ video_id: 'IvQkb8aHPu8' });
  assert.deepEqual(observed, [true, true, false]);
});
