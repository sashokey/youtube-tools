// ==UserScript==
// @name         YouTube Tools
// @namespace    https://github.com/sashokey/youtube-tools
// @version      1.0.10
// @description  Quick feedback, watched-video filtering, audio-only playback, and manual playlist navigation.
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-start
// @inject-into  page
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_addStyle
// @grant        unsafeWindow
// @homepageURL  https://github.com/sashokey/youtube-tools
// @license      GPL-3.0-only
// ==/UserScript==

import { audio } from "./src/audio.ts";
import { mobile, ready } from "./src/dom.ts";
import { feedback } from "./src/feedback.ts";
import { playlist } from "./src/playlist.ts";
import { settings } from "./src/settings.ts";
import { initializePreferences } from "./src/state.ts";
import { watched } from "./src/watched.ts";

const key = Symbol.for("sashokey.youtube-tools");

if (
  !Reflect.has(document, key) &&
  window.top === window &&
  (mobile || location.hostname === "www.youtube.com") &&
  !location.pathname.startsWith("/embed/")
) {
  Object.defineProperty(document, key, { value: true });
  initializePreferences();
  audio();
  playlist();
  ready(() => {
    settings();
    watched();
    feedback();
  });
}
