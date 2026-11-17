import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const artifact =
  process.env.YOUTUBE_TOOLS_ARTIFACT === "youtube-tools.debug.js"
    ? "youtube-tools.debug.js"
    : "youtube-tools.user.js";
const code = await readFile(new URL(`../${artifact}`, import.meta.url), "utf8");
const playlist = "/watch?v=abcdefghijk&list=RDabcdefghijk";
const ordinary = "/watch?v=lmnopqrstuv";
const stateChange = "player-state-change";

class MutationObserver {
  observe(): void {}
  disconnect(): void {}
}

class NativeVideo extends EventTarget {
  readonly HAVE_CURRENT_DATA = 2;
  isConnected = true;
  seeking = true;
  paused = false;
  ended = false;
  videoWidth = 0;
  readyState = 1;
  currentTime = 1827.661;
  duration = 1828;
  playerState = 0;
  ad = false;
  readonly seeks: [number, boolean][] = [];
  readonly player = {
    classList: {
      contains: (token: string) => token === "ad-showing" && this.ad,
    },
    getPlayerState: () => this.playerState,
    querySelector: (selector: string) =>
      selector === "video" && this.isConnected ? this : null,
    seekTo: (time: number, allowSeekAhead: boolean) => {
      this.seeks.push([time, allowSeekAhead]);
      this.currentTime = time;
    },
  };

  closest(selector: string) {
    return selector === "#movie_player" ? this.player : null;
  }
}

function start(
  host: "www.youtube.com" | "m.youtube.com",
  path: string,
  manager?: object,
) {
  const location = new URL(path, `https://${host}`);
  let timerId = 0;
  const timers = new Map<number, () => void>();
  const window = Object.assign(new EventTarget(), {
    setTimeout(callback: () => void): number {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout(id: number): void {
      timers.delete(id);
    },
  });
  Object.defineProperty(window, "top", { value: window });
  const root = Object.assign(new EventTarget(), {
    querySelector: (selector: string) =>
      selector === "yt-playlist-manager" ? (manager ?? null) : null,
    querySelectorAll: () => [],
  });
  const document = Object.assign(new EventTarget(), {
    readyState: "complete",
    querySelector: (selector: string) =>
      selector === "ytd-app" || selector === "ytm-app"
        ? root
        : root.querySelector(selector),
    querySelectorAll: () => [],
  });
  runInNewContext(code, {
    window,
    document,
    location,
    URLSearchParams,
    Event,
    CustomEvent,
    HTMLVideoElement: NativeVideo,
    MutationObserver,
    unsafeWindow: window,
    customElements: { whenDefined: () => new Promise<never>(() => {}) },
    GM_getValue: () => false,
    GM_addValueChangeListener() {},
    GM_addStyle() {},
  });
  return {
    window,
    navigate(path: string, event = "popstate") {
      location.href = new URL(path, location).href;
      window.dispatchEvent(new Event(event));
    },
    seeking(media: NativeVideo): void {
      const event = new Event("seeking");
      Object.defineProperty(event, "target", { value: media });
      document.dispatchEvent(event);
    },
    seeked(media: NativeVideo): void {
      const event = new Event("seeked");
      Object.defineProperty(event, "target", { value: media });
      document.dispatchEvent(event);
    },
    pending(): number {
      return timers.size;
    },
    flushTimeouts(): void {
      for (const id of [...timers.keys()]) {
        const callback = timers.get(id);
        timers.delete(id);
        callback?.();
      }
    },
  };
}

class NativePlaylist {
  #autoAdvance = true;
  get shouldAdvance(): boolean {
    return this.#autoAdvance;
  }
  setCanAutoAdvance(value: boolean): void {
    this.#autoAdvance = value;
  }
}

void test("desktop disables autoplay through TEST_ONLY using its native receiver", () => {
  const native = new NativePlaylist();
  const page = start("www.youtube.com", playlist, {
    polymerController: {},
    TEST_ONLY: native,
    get canAutoAdvance_(): never {
      throw new Error("Autoplay state is unavailable");
    },
  });
  assert.equal(native.shouldAdvance, false);

  page.navigate(ordinary);
  assert.equal(native.shouldAdvance, false);
});

void test("desktop restores TEST_ONLY autoplay state through its own getter", () => {
  class ReadablePlaylist extends NativePlaylist {
    getCanAutoAdvance(): boolean {
      return this.shouldAdvance;
    }
  }

  const native = new ReadablePlaylist();
  const page = start("www.youtube.com", playlist, { TEST_ONLY: native });
  assert.equal(native.shouldAdvance, false);

  page.navigate(ordinary);
  assert.equal(native.shouldAdvance, true);
});

for (const initial of [true, false]) {
  void test(`desktop restores readable TEST_ONLY autoplay state from ${initial}`, () => {
    const writes: boolean[] = [];
    const manager = {
      canAutoAdvance_: initial,
      TEST_ONLY: {
        setCanAutoAdvance(value: boolean) {
          writes.push(value);
          manager.canAutoAdvance_ = value;
        },
      },
    };
    const page = start("www.youtube.com", playlist, manager);
    assert.equal(manager.canAutoAdvance_, false);
    assert.equal(writes.at(-1), false);

    const writesAfterDisable = writes.length;
    page.navigate(playlist);
    assert.equal(writes.length, writesAfterDisable);

    page.navigate(ordinary);
    assert.equal(manager.canAutoAdvance_, initial);
    assert.equal(writes.at(-1), initial);
  });
}

void test("desktop blocks a replacement controller after window-only YouTube navigation", () => {
  const previous = { canAutoAdvance_: true };
  const replacement = { canAutoAdvance_: true };
  const manager = { polymerController: previous };
  const page = start("www.youtube.com", playlist, manager);
  assert.equal(previous.canAutoAdvance_, false);

  manager.polymerController = replacement;
  page.navigate(`${ordinary}&list=RDabcdefghijk`, "yt-navigate-finish");
  assert.equal(replacement.canAutoAdvance_, false);
  assert.equal(previous.canAutoAdvance_, true);
});

void test("desktop disables autoplay through a configurable controller accessor", () => {
  const controller = {
    nativeValue: true,
    get canAutoAdvance_() {
      return this.nativeValue;
    },
    set canAutoAdvance_(value: boolean) {
      this.nativeValue = value;
    },
  };
  const original = Object.getOwnPropertyDescriptor(
    controller,
    "canAutoAdvance_",
  );
  const page = start("www.youtube.com", playlist, {
    polymerController: controller,
  });
  assert.equal(controller.canAutoAdvance_, false);

  page.navigate(ordinary);
  assert.equal(controller.canAutoAdvance_, true);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(controller, "canAutoAdvance_"),
    original,
  );
});

void test("desktop disables autoplay on a writable non-configurable controller flag", () => {
  const controller = { canAutoAdvance_: true };
  Object.defineProperty(controller, "canAutoAdvance_", { configurable: false });
  const page = start("www.youtube.com", playlist, {
    polymerController: controller,
  });
  assert.equal(controller.canAutoAdvance_, false);

  page.navigate(ordinary);
  assert.equal(controller.canAutoAdvance_, true);
});

void test("desktop falls back to the manager flag when the controller has no flag", () => {
  const manager = { polymerController: {}, canAutoAdvance_: true };
  start("www.youtube.com", playlist, manager);
  assert.equal(manager.canAutoAdvance_, false);
});

void test("desktop uses TEST_ONLY when the controller setter leaves autoplay enabled", () => {
  const native = new NativePlaylist();
  start("www.youtube.com", playlist, {
    polymerController: {
      get canAutoAdvance_(): boolean {
        return true;
      },
      set canAutoAdvance_(_value: boolean) {},
    },
    TEST_ONLY: native,
  });
  assert.equal(native.shouldAdvance, false);
});

void test("desktop uses the manager flag when the TEST_ONLY setter leaves autoplay enabled", () => {
  const manager = {
    canAutoAdvance_: true,
    TEST_ONLY: {
      getCanAutoAdvance: () => true,
      setCanAutoAdvance() {},
    },
  };
  const page = start("www.youtube.com", playlist, manager);
  assert.equal(manager.canAutoAdvance_, false);

  page.navigate(ordinary);
  assert.equal(manager.canAutoAdvance_, true);
});

void test("desktop leaves a protected TEST_ONLY getter alone when the controller works", () => {
  let reads = 0;
  const controller = { canAutoAdvance_: true };
  const manager = {
    polymerController: controller,
    get TEST_ONLY(): never {
      reads++;
      throw new Error("TEST_ONLY is unavailable");
    },
  };
  start("www.youtube.com", playlist, manager);
  assert.equal(controller.canAutoAdvance_, false);
  assert.equal(reads, 0);
});

void test("desktop still disables autoplay when controller and TEST_ONLY getters throw", () => {
  const manager = {
    canAutoAdvance_: true,
    get polymerController(): never {
      throw new Error("Controller is unavailable");
    },
    get TEST_ONLY(): never {
      throw new Error("TEST_ONLY is unavailable");
    },
  };
  assert.doesNotThrow(() => start("www.youtube.com", playlist, manager));
  assert.equal(manager.canAutoAdvance_, false);
});

void test("desktop leaves native getters alone on routes without a playlist", () => {
  let reads = 0;
  const controller = { canAutoAdvance_: true };
  const original = Object.getOwnPropertyDescriptor(
    controller,
    "canAutoAdvance_",
  );
  const page = start("www.youtube.com", ordinary, {
    get polymerController() {
      reads++;
      return controller;
    },
  });
  page.navigate("/feed/subscriptions?list=RDabcdefghijk");
  assert.equal(reads, 0);
  assert.equal(controller.canAutoAdvance_, true);

  page.navigate(playlist);
  assert.equal(controller.canAutoAdvance_, false);
  controller.canAutoAdvance_ = true;
  page.navigate(ordinary);
  assert.equal(controller.canAutoAdvance_, true);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(controller, "canAutoAdvance_"),
    original,
  );
});

const endedEvents = {
  CustomEvent: () => new CustomEvent(stateChange, { detail: { state: 0 } }),
  Event: () => Object.assign(new Event(stateChange), { detail: { state: 0 } }),
};

for (const [kind, ended] of Object.entries(endedEvents)) {
  void test(`mobile playlist blocks late window listeners for an ended ${kind}`, () => {
    const { window } = start("m.youtube.com", playlist);
    let nativeAdvance = 0;
    window.addEventListener(
      stateChange,
      () => {
        nativeAdvance++;
      },
      true,
    );
    window.dispatchEvent(ended());
    assert.equal(nativeAdvance, 0);
  });
}

void test("mobile playlist delivers playing, paused and malformed state events", () => {
  const { window } = start("m.youtube.com", playlist);
  const seen: unknown[] = [];
  window.addEventListener(
    stateChange,
    (event) => {
      seen.push("detail" in event ? event.detail : undefined);
    },
    true,
  );
  for (const detail of [{ state: 1 }, { state: 2 }, { state: "0" }, null, {}]) {
    window.dispatchEvent(new CustomEvent(stateChange, { detail }));
  }
  window.dispatchEvent(new Event(stateChange));
  assert.deepEqual(seen, [
    { state: 1 },
    { state: 2 },
    { state: "0" },
    null,
    {},
    undefined,
  ]);
});

void test("mobile delivers ended events on routes without an active playlist", () => {
  const page = start("m.youtube.com", playlist);
  let received = 0;
  page.window.addEventListener(
    stateChange,
    () => {
      received++;
    },
    true,
  );
  for (const path of [
    ordinary,
    `${ordinary}&list=`,
    "/feed/subscriptions?list=RDabcdefghijk",
  ]) {
    page.navigate(path);
    page.window.dispatchEvent(endedEvents.Event());
  }
  assert.equal(received, 3);
});

for (const host of ["www.youtube.com", "m.youtube.com"] as const) {
  void test(`${host} completes an audio playlist seek that YouTube treated as ended before buffering`, () => {
    const page = start(host, playlist);
    const media = new NativeVideo();
    page.seeking(media);
    page.seeking(media);
    assert.equal(page.pending(), 1);
    page.flushTimeouts();
    assert.deepEqual(media.seeks, [[1826.661, true]]);
    page.seeking(media);
    page.flushTimeouts();
    assert.equal(page.pending(), 0);
    assert.equal(media.seeks.length, 1);
  });
}

for (const delivery of ["synchronous", "queued"] as const) {
  void test(`a ${delivery} seeking event from a clamped retry cannot sustain a recovery loop`, () => {
    const page = start("www.youtube.com", playlist);
    const media = new NativeVideo();
    media.player.seekTo = (time, allowSeekAhead) => {
      media.seeks.push([time, allowSeekAhead]);
      if (delivery === "synchronous") page.seeking(media);
    };
    page.seeking(media);
    page.flushTimeouts();
    if (delivery === "queued") page.seeking(media);
    assert.equal(page.pending(), 0);
    assert.deepEqual(media.seeks, [[1826.661, true]]);

    media.seeking = false;
    page.seeked(media);
    media.seeking = true;
    page.seeking(media);
    page.flushTimeouts();
    assert.equal(page.pending(), 0);
    assert.deepEqual(media.seeks, [
      [1826.661, true],
      [1826.661, true],
    ]);
  });
}

for (const [label, intervene] of [
  [
    "finished loading",
    (media: NativeVideo) => {
      media.seeking = false;
    },
  ],
  [
    "already buffered",
    (media: NativeVideo) => {
      media.readyState = 4;
    },
  ],
  [
    "still playing",
    (media: NativeVideo) => {
      media.playerState = 1;
    },
  ],
  [
    "paused by the viewer",
    (media: NativeVideo) => {
      media.paused = true;
    },
  ],
  [
    "normal video",
    (media: NativeVideo) => {
      media.videoWidth = 1280;
    },
  ],
  [
    "updated seek target",
    (media: NativeVideo) => {
      media.currentTime = 1827.9;
    },
  ],
  [
    "replaced video",
    (media: NativeVideo) => {
      media.isConnected = false;
    },
  ],
  [
    "ad started",
    (media: NativeVideo) => {
      media.ad = true;
    },
  ],
] as const) {
  void test(`a delayed audio endpoint recovery preserves a ${label}`, () => {
    const page = start("www.youtube.com", playlist);
    const media = new NativeVideo();
    page.seeking(media);
    intervene(media);
    page.flushTimeouts();
    assert.deepEqual(media.seeks, []);
  });
}

void test("a delayed audio endpoint recovery does not follow a reused player into another item", () => {
  const page = start("www.youtube.com", playlist);
  const media = new NativeVideo();
  page.seeking(media);
  page.navigate(`${ordinary}&list=RDabcdefghijk`);
  page.flushTimeouts();
  assert.deepEqual(media.seeks, []);
});

void test("endpoint recovery schedules no work for a regular movie or an ordinary audio seek", () => {
  const regular = start("m.youtube.com", ordinary);
  regular.seeking(new NativeVideo());
  assert.equal(regular.pending(), 0);
  const playing = start("m.youtube.com", playlist);
  const media = new NativeVideo();
  media.currentTime = 1704.85;
  playing.seeking(media);
  assert.equal(playing.pending(), 0);
});
