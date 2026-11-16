import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';
import { appTag, candidate, freshPage, hosts, preference, urlFor } from './harness.ts';
import type { Host } from './harness.ts';
import { translations, viewports } from './locales.ts';

let browser: Browser;
before(async () => { browser = await chromium.launch({ args: ['--disable-extensions', '--mute-audio'] }); });
after(async () => { await browser?.close(); });

const focusableSettings = '<ytd-popup-container><tp-yt-iron-dropdown><ytd-multi-page-menu-renderer><ytd-compact-link-renderer id="keyboard"><a>Keyboard shortcuts</a></ytd-compact-link-renderer></ytd-multi-page-menu-renderer></tp-yt-iron-dropdown></ytd-popup-container>';
const settingsInit = 'const keyboard=document.querySelector("#keyboard");if(keyboard)keyboard.data={icon:{iconType:"KEYBOARD"}};';
const interest = 'Not interested';
const channel = "Don't recommend channel";

function settingsFor(host: Host): string {
  const app = appTag(host);
  return `<${app}>${host === 'm.youtube.com' ? '<ytm-settings><button class="stock">Switch account</button></ytm-settings>' : focusableSettings}</${app}>`;
}

function card(id: string, progress?: number, list = ''): string {
  const playback = progress === undefined ? '' : `<yt-thumbnail-overlay-progress-bar-view-model><div class="ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment" style="width:${progress}%"></div></yt-thumbnail-overlay-progress-bar-view-model>`;
  return `<yt-lockup-view-model id="${id}"><a class="ytLockupViewModelContentImage" href="/watch?v=abcdefghijk${list ? `&amp;list=${list}` : ''}"><img alt="Video">${playback}</a><div class="ytLockupMetadataViewModelMenuButton"><button aria-label="More actions" class="stock menu-trigger">More</button></div></yt-lockup-view-model>`;
}

function oldProgressCard(id: string, host: Host, progress: number): string {
  if (host === 'm.youtube.com') {
    return `<ytm-video-with-context-renderer id="${id}"><a href="/watch?v=abcdefghijk"><img alt="Video"></a><ytw-thumbnail-overlay-resume-playback-renderer><div class="ytwThumbnailOverlayResumePlaybackRendererThumbnailOverlayResumePlaybackProgress" style="width:${progress}%"></div></ytw-thumbnail-overlay-resume-playback-renderer></ytm-video-with-context-renderer>`;
  }
  return `<ytd-video-renderer id="${id}"><a id="thumbnail" href="/watch?v=abcdefghijk"><img alt="Video"></a><ytd-thumbnail-overlay-resume-playback-renderer><div id="progress" style="width:${progress}%"></div></ytd-thumbnail-overlay-resume-playback-renderer></ytd-video-renderer>`;
}

function withBrowse(host: Host, html: string, subtype = 'home'): string {
  const app = appTag(host);
  const prefix = host === 'm.youtube.com' ? 'ytm' : 'ytd';
  return `<${app}><${prefix}-page-manager><${prefix}-browse page-subtype="${subtype}">${html}</${prefix}-browse></${prefix}-page-manager></${app}>`;
}

function feedbackMenu(host: Host, items: string[]): string {
  const close = host === 'm.youtube.com' ? '<button class="close-button" aria-label="Close"></button>' : '';
  const rows = items.map(name => `<yt-list-item-view-model><div><button role="menuitem">${name}</button></div></yt-list-item-view-model>`).join('');
  return `<bottom-sheet-container>${close}<yt-sheet-view-model role="menu">${rows}</yt-sheet-view-model></bottom-sheet-container>`;
}

async function serve(context: BrowserContext, html: string | ((host: Host) => string), script = '', language = 'en-US', rtl = false): Promise<void> {
  await context.route(/^https:\/\/(?:www|m)\.youtube\.com\//, route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="${language}" dir="${rtl ? 'rtl' : 'ltr'}"><head><style>
       :root{--yt-spec-base-background:#fff;--yt-spec-text-primary:#0f0f0f}
       @media(prefers-color-scheme:dark){:root{--yt-spec-base-background:#0f0f0f;--yt-spec-text-primary:#fff}}
       body{background:var(--yt-spec-base-background);color:var(--yt-spec-text-primary)}
       ytd-app,ytm-app,ytd-browse,ytm-browse,yt-lockup-view-model,ytd-video-renderer,ytm-video-with-context-renderer,ytd-compact-link-renderer,yt-list-item-view-model{display:block}
       [hidden]{display:none!important}
       a:has(img){display:block;width:min(320px,80vw);aspect-ratio:16/9}
       .stock{width:40px;height:40px}ytm-settings .stock{height:48px}
    </style></head><body>${typeof html === 'string' ? html : html(new URL(route.request().url()).hostname === 'm.youtube.com' ? 'm.youtube.com' : 'www.youtube.com')}<script>${script}</script></body></html>`,
  }));
}

async function fixture(host: Host, path: string, html: string, run: (page: Page, context: BrowserContext) => Promise<void>, init = '', language = 'en-US', options: BrowserContextOptions = {}, rtl = false): Promise<void> {
  await freshPage(browser, host, async (page, context) => {
    context.setDefaultTimeout(4500);
    await serve(context, html, init, language, rtl);
    await candidate(context);
    await page.goto(urlFor(host, path).href);
    await run(page, context);
  }, options);
}

async function reveal(page: Page, host: Host, id: string): Promise<void> {
  if (host === 'www.youtube.com') await page.locator(`#${id} a:has(img)`).focus();
}

for (const host of hosts) {
  const mobile = host === 'm.youtube.com';
  const switchRole = mobile ? 'switch' : 'menuitemcheckbox';
  const switchPath = mobile ? '/select_site' : '/';

  for (const [index, language] of translations.entries()) {
    const viewport = viewports[index % viewports.length] ?? viewports[0];
    const colorScheme = index % 2 === 0 ? 'light' : 'dark';
    const rtl = 'direction' in language;
    void test(`${host} settings follow YouTube language ${language.language || '(unset)'} at ${viewport.width}×${viewport.height}`, async () => {
      await fixture(host, switchPath, settingsFor(host), async page => {
        for (const name of [language.watched, language.audio]) {
          const toggle = page.getByRole(switchRole, { name, exact: true });
          assert.equal(await toggle.count(), 1, `Missing ${name}`);
          assert.equal(await toggle.getAttribute('aria-checked'), 'false');
          const box = await toggle.boundingBox();
          assert.ok(box && box.height === (mobile ? 48 : 40) && box.x >= 0 && box.x + box.width <= viewport.width + 1);
        }
      }, settingsInit, language.language, { viewport, colorScheme, locale: 'sv-SE' }, rtl);
    });
    void test(`${host} quick actions follow YouTube language ${language.language || '(unset)'}`, async () => {
      await fixture(host, '/', withBrowse(host, card('choice')), async page => {
        await reveal(page, host, 'choice');
        for (const name of [language.interest, language.channel]) {
          assert.equal(await page.locator('#choice').getByRole('button', { name, exact: true }).count(), 1, `Missing ${name}`);
        }
      }, '', language.language, { viewport, colorScheme, locale: 'sv-SE' }, rtl);
    });
  }

  void test(`${host} independent switches persist on reload and react to a remote change`, async () => {
    await fixture(host, switchPath, settingsFor(host), async (page, context) => {
      const audio = page.getByRole(switchRole, { name: 'Audio only', exact: true });
      const watched = page.getByRole(switchRole, { name: 'Watched videos', exact: true });
      assert.equal(await audio.count(), 1);
      assert.equal(await watched.count(), 1);
      await audio.press('Space');
      assert.equal(await audio.getAttribute('aria-checked'), 'true');
      assert.equal(await watched.getAttribute('aria-checked'), 'false');
      await page.reload();
      assert.equal(await audio.getAttribute('aria-checked'), 'true');
      const other = await context.newPage();
      try {
        await other.goto(page.url());
        assert.equal(await other.getByRole(switchRole, { name: 'Audio only', exact: true }).getAttribute('aria-checked'), 'true');
        await preference(page, 'audioOnly', false);
        assert.equal(await audio.getAttribute('aria-checked'), 'false');
      } finally {
        await other.close();
      }
    }, `${settingsInit}document.addEventListener('keydown',event=>{if(event.key===' ')event.preventDefault();},true);`);
  });

  for (const [name, selected] of [[interest, 'interest'], [channel, 'channel']] as const) {
    void test(`${host} quick feedback delegates ${selected} and keeps native Undo`, async () => {
      const popup = feedbackMenu(host, [interest, channel]);
      const init = `const card=document.querySelector('#choice');const trigger=card.querySelector('.menu-trigger');trigger.onclick=()=>{document.body.insertAdjacentHTML('beforeend',${JSON.stringify(popup)});const sheet=document.querySelector('bottom-sheet-container');for(const item of sheet.querySelectorAll('[role=menuitem]'))item.onclick=()=>{sheet.remove();card.dataset.feedback=item.textContent;card.hidden=true;const undo=document.createElement('button');undo.textContent='Undo';undo.onclick=()=>{card.hidden=false;undo.remove();};document.body.append(undo);};};`;
      await fixture(host, '/', withBrowse(host, card('choice')), async page => {
        await reveal(page, host, 'choice');
        const button = page.locator('#choice').getByRole('button', { name, exact: true });
        assert.equal(await button.count(), 1);
        await button.click();
        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        await undo.waitFor({ timeout: 4000 });
        assert.equal(await page.locator('#choice').isVisible(), false);
        assert.equal(await page.locator('#choice').getAttribute('data-feedback'), name);
        await undo.click();
        assert.equal(await page.locator('#choice').isVisible(), true);
      }, init);
    });
  }

  void test(`${host} Mix with no channel feedback displays Unavailable and closes its own menu`, async () => {
    const popup = feedbackMenu(host, [interest, 'Save to library']);
    const init = `document.querySelector('#mix .menu-trigger').onclick=()=>{document.body.insertAdjacentHTML('beforeend',${JSON.stringify(popup)});const sheet=document.querySelector('bottom-sheet-container');for(const item of sheet.querySelectorAll('[role=menuitem]'))item.onclick=()=>document.body.dataset.unexpected='yes';sheet.querySelector('.close-button')?.addEventListener('click',()=>sheet.remove());document.body.addEventListener('click',event=>{if(event.target===document.body)sheet.remove();});};`;
    await fixture(host, '/', withBrowse(host, card('mix', undefined, 'RDabcdefghijk')), async page => {
      await reveal(page, host, 'mix');
      const action = page.locator('#mix').getByRole('button', { name: channel, exact: true });
      assert.equal(await action.count(), 1);
      await action.click();
      await page.getByRole('button', { name: 'Unavailable', exact: true }).waitFor({ timeout: 4200 });
      assert.equal(await page.locator('bottom-sheet-container').count(), 0);
      assert.equal(await page.locator('body').getAttribute('data-unexpected'), null);
    }, init);
  });

  for (const path of ['/', '/@youtubecreators/videos']) void test(`${host} filters partial and completed videos on ${path}`, async () => {
    const panel = mobile ? 'ytm-playlist-panel-renderer' : 'ytd-playlist-panel-renderer';
    const markup = withBrowse(host, card('partial', 10) + card('complete', 100) + card('zero', 0) +
      oldProgressCard('older', host, 17) + `<${panel}>${card('in-playlist', 100)}</${panel}>`, path === '/' ? 'home' : 'channels');
    await fixture(host, path, markup, async page => {
      for (const id of ['partial', 'complete', 'older']) assert.equal(await page.locator(`#${id}`).isVisible(), false, id);
      for (const id of ['zero', 'in-playlist']) assert.equal(await page.locator(`#${id}`).isVisible(), true, id);
      await preference(page, 'showWatched', true);
      for (const id of ['partial', 'complete', 'older']) assert.equal(await page.locator(`#${id}`).isVisible(), true, id);
    });
  });

  void test(`${host} leaves history cards and advertising outside quick feedback`, async () => {
    const ad = mobile ? 'ytm-promoted-sparkles-web-renderer' : 'ytd-ad-slot-renderer';
    await fixture(host, '/feed/history', withBrowse(host, card('history', 100), 'history'), async page => {
      assert.equal(await page.locator('#history').isVisible(), true);
      await reveal(page, host, 'history');
      assert.equal(await page.getByRole('button', { name: interest, exact: true }).count(), 0);
    });
    await fixture(host, '/', withBrowse(host, `<${ad}>${card('ad') }</${ad}>${card('ordinary')}`), async page => {
      await reveal(page, host, 'ordinary');
      assert.equal(await page.locator('#ordinary').getByRole('button', { name: interest, exact: true }).count(), 1);
      await reveal(page, host, 'ad');
      assert.equal(await page.locator('#ad').getByRole('button', { name: interest, exact: true }).count(), 0);
    });
  });

  void test(`${host} applies the current audio mode when loading a previously preloaded video`, async () => {
    const init = `const preloads=new Map();const p={preloadVideoByPlayerVars(args){preloads.set(args.video_id,args.audio_only===true);},loadVideoByPlayerVars(args){document.body.dataset.mode=String(args.audio_only??preloads.get(args.video_id)??false);}};window.yt={player:{Application:{create(){return p;}}}};const player=window.yt.player.Application.create(document.querySelector('video'),{args:{video_id:'abcdefghijk'}});const vars={video_id:'lmnopqrstuv'};document.querySelector('#preload').onclick=()=>player.preloadVideoByPlayerVars(vars);document.querySelector('#load').onclick=()=>player.loadVideoByPlayerVars(vars);`;
    await fixture(host, '/watch?v=abcdefghijk', '<video></video><button id="preload">Preload</button><button id="load">Load</button>', async page => {
      const media = page.locator('video');
      assert.equal(await media.count(), 1);
      await page.getByRole('button', { name: 'Preload', exact: true }).click();
      await preference(page, 'audioOnly', true);
      await page.getByRole('button', { name: 'Load', exact: true }).click();
      assert.equal(await page.locator('body').getAttribute('data-mode'), 'true', 'Enable after native video preload');
      await page.getByRole('button', { name: 'Preload', exact: true }).click();
      await preference(page, 'audioOnly', false);
      await page.getByRole('button', { name: 'Load', exact: true }).click();
      assert.equal(await page.locator('body').getAttribute('data-mode'), 'false', 'Restore video after native audio preload');
      assert.equal(await media.count(), 1);
    }, init);
  });
}

void test('both preferences propagate between desktop and mobile tabs', async () => {
  await freshPage(browser, 'www.youtube.com', async (desktop, context) => {
    await serve(context, settingsFor, settingsInit);
    await context.exposeBinding('specRelayPreference', async ({ page: sender }, data: unknown) => {
      if (!data || typeof data !== 'object' || !('name' in data) || !('value' in data) ||
          (data.name !== 'audioOnly' && data.name !== 'showWatched') || typeof data.value !== 'boolean') return;
      const { name, value } = data;
      await Promise.all(context.pages().filter(page => page !== sender).map(page => preference(page, name, value)));
    });
    await context.addInitScript(() => {
      document.addEventListener('spec-local-preference', event => {
        const relay: unknown = Reflect.get(window, 'specRelayPreference');
        if (event instanceof CustomEvent && typeof relay === 'function') void Promise.resolve(Reflect.apply(relay, window, [event.detail])).catch(() => undefined);
      });
    });
    await candidate(context);
    const mobile = await context.newPage();
    try {
      await desktop.goto(urlFor('www.youtube.com', '/').href);
      await mobile.goto(urlFor('m.youtube.com', '/select_site').href);
      const desktopAudio = desktop.getByRole('menuitemcheckbox', { name: 'Audio only', exact: true });
      const mobileAudio = mobile.getByRole('switch', { name: 'Audio only', exact: true });
      const desktopWatched = desktop.getByRole('menuitemcheckbox', { name: 'Watched videos', exact: true });
      const mobileWatched = mobile.getByRole('switch', { name: 'Watched videos', exact: true });
      assert.equal(await desktopAudio.count(), 1);
      assert.equal(await mobileAudio.count(), 1);
      await desktopAudio.click();
      await mobile.getByRole('switch', { name: 'Audio only', checked: true, exact: true }).waitFor({ timeout: 2500 });
      await mobileWatched.click();
      await desktop.getByRole('menuitemcheckbox', { name: 'Watched videos', checked: true, exact: true }).waitFor({ timeout: 2500 });
      await desktop.reload();
      await mobile.reload();
      assert.equal(await desktopAudio.getAttribute('aria-checked'), 'true');
      assert.equal(await desktopWatched.getAttribute('aria-checked'), 'true');
      assert.equal(await mobileAudio.getAttribute('aria-checked'), 'true');
      assert.equal(await mobileWatched.getAttribute('aria-checked'), 'true');
    } finally {
      await mobile.close();
    }
  });
});
