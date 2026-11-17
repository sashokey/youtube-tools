import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const artifact =
  process.env.YOUTUBE_TOOLS_ARTIFACT === "youtube-tools.debug.js"
    ? "youtube-tools.debug.js"
    : "youtube-tools.user.js";
const code = await readFile(new URL(`../${artifact}`, import.meta.url), "utf8");
const videoId = "IvQkb8aHPu8";

function install(
  application: object,
  audioOnly = true,
  setImplementation?: SetConstructor,
  hostname = "m.youtube.com",
): () => void {
  const window = {
    get top() {
      return window;
    },
    addEventListener() {},
  };
  const unsafeWindow: { yt?: { player: { Application: object } } } = {};
  const listeners = new Map<
    string,
    (key: string, before: boolean, after: boolean) => void
  >();
  runInNewContext(
    code,
    {
      window,
      unsafeWindow,
      location: { hostname, pathname: "/watch", search: "" },
      document: { readyState: "loading", addEventListener() {} },
      ...(setImplementation && { Set: setImplementation }),
      GM_getValue: (key: string) => key === "audioOnly" && audioOnly,
      GM_addValueChangeListener: (
        key: string,
        listener: (key: string, before: boolean, after: boolean) => void,
      ) => listeners.set(key, listener),
    },
    { filename: artifact },
  );
  unsafeWindow.yt = { player: { Application: application } };
  return () => {
    const listener = listeners.get("audioOnly");
    assert.ok(listener);
    listener("audioOnly", true, false);
  };
}

for (const placement of ["own", "inherited"] as const) {
  void test(`native ${placement} factory accessors retain their getter and setter when audio is off`, () => {
    let factory = () => "original";
    const setterReceivers: unknown[] = [];
    let getterCalls = 0;
    const accessor = {
      get create() {
        getterCalls++;
        return factory;
      },
      set create(value: typeof factory) {
        setterReceivers.push(this);
        factory = value;
      },
    };
    const application: unknown =
      placement === "own" ? accessor : Object.create(accessor);
    assert.ok(application && typeof application === "object");
    install(application, false);
    const replacement = () => "replacement";
    assert.equal(Reflect.set(application, "create", replacement), true);
    assert.equal(setterReceivers.length, 1);
    assert.equal(setterReceivers[0], application);
    assert.equal(getterCalls, 0);
    assert.equal(Reflect.get(application, "create"), replacement);
    assert.equal(getterCalls, 1);
    assert.equal(Object.hasOwn(application, "create"), placement === "own");
  });
}

void test("an inherited read-only native factory stays protected", () => {
  const original = () => "original";
  const prototype = Object.defineProperty({}, "create", { value: original });
  const application: unknown = Object.create(prototype);
  assert.ok(application && typeof application === "object");
  install(application, false);
  assert.equal(
    Reflect.set(application, "create", () => "replacement"),
    false,
  );
  assert.equal(Reflect.get(application, "create"), original);
  assert.equal(Object.hasOwn(application, "create"), false);
});

void test("a throwing config.args getter leaves native player creation usable", () => {
  const config = {
    get args(): never {
      throw new Error("Cannot inspect player arguments");
    },
  };
  const element = {};
  const extra = {};
  const receiver = {};
  const player = {};
  let calls = 0;
  const application = {
    create(this: unknown, ...args: unknown[]): object {
      calls++;
      assert.equal(this, receiver);
      assert.equal(args.length, 3);
      assert.equal(args[0], element);
      assert.equal(args[1], config);
      assert.equal(args[2], extra);
      return player;
    },
  };
  install(application);
  let result: unknown;
  assert.doesNotThrow(() => {
    result = application.create.call(receiver, element, config, extra);
  });
  assert.equal(result, player);
  assert.equal(calls, 1);
});

void test("failed audio preparation still propagates the original native factory error once", () => {
  const expected = new Error("Native player initialization failed");
  const config = {
    get args(): never {
      throw new Error("Cannot inspect alternate player arguments");
    },
  };
  let calls = 0;
  const application = {
    createAlternate(element: null, value: unknown): never {
      calls++;
      assert.equal(element, null);
      assert.equal(value, config);
      throw expected;
    },
  };
  install(application);
  assert.throws(
    () => application.createAlternate(null, config),
    (error) => error === expected,
  );
  assert.equal(calls, 1);
});

void test("a payload with an unsupported audio write leaves native transport usable", () => {
  const payload = new Proxy(
    { video_id: videoId },
    {
      ownKeys() {
        throw new Error("Cannot copy the native payload");
      },
      getOwnPropertyDescriptor() {
        throw new Error("Cannot inspect the native payload");
      },
      set() {
        throw new Error("Cannot write to the native payload");
      },
    },
  );
  const extra = {};
  const receiver = {};
  const result = {};
  let calls = 0;
  const player = {
    cueVideoByPlayerVars(this: unknown, ...args: unknown[]): object {
      calls++;
      assert.equal(this, receiver);
      assert.equal(args.length, 2);
      assert.equal(args[0], payload);
      assert.equal(args[1], extra);
      return result;
    },
  };
  const application = { create: () => player };
  install(application);
  application.create();
  let returned: unknown;
  assert.doesNotThrow(() => {
    returned = player.cueVideoByPlayerVars.call(receiver, payload, extra);
  });
  assert.equal(returned, result);
  assert.equal(calls, 1);
});

for (const [shape, args] of [
  ["array", [videoId]],
  ["frozen", Object.freeze({ video_id: videoId })],
] as const) {
  void test(`${shape} player arguments go to the native methods unchanged`, () => {
    const config = { args };
    let received: unknown;
    const player = {
      loadVideoByPlayerVars(payload: unknown): unknown {
        return payload;
      },
    };
    const application = {
      create(_element: null, value: unknown): object {
        received = value;
        return player;
      },
    };
    install(application);
    application.create(null, config);
    const payload = player.loadVideoByPlayerVars(args);
    assert.equal(received, config);
    assert.equal(payload, args);
    assert.equal(Object.hasOwn(args, "audio_only"), false);
  });
}

void test("a player configuration with private fields reaches the native factory intact", () => {
  class BrandedConfig {
    readonly args = { video_id: videoId };
    #token = "native token";

    token(): string {
      return this.#token;
    }
  }
  const config = new BrandedConfig();
  let received: unknown;
  const application = {
    create(_element: null, value: BrandedConfig): string {
      received = value;
      return value.token();
    },
  };
  install(application);
  let result: unknown;
  assert.doesNotThrow(() => {
    result = application.create(null, config);
  });
  assert.equal(result, "native token");
  assert.equal(received, config);
  assert.equal(Object.hasOwn(config.args, "audio_only"), false);
});

void test("a transport payload with native internal slots reaches the player intact", () => {
  const payload = Object.assign(new Date(123), { video_id: videoId });
  let received: unknown;
  const player = {
    loadVideoByPlayerVars(value: Date): number {
      received = value;
      return value.getTime();
    },
  };
  const application = { create: () => player };
  install(application);
  application.create();
  let result: unknown;
  assert.doesNotThrow(() => {
    result = player.loadVideoByPlayerVars(payload);
  });
  assert.equal(result, 123);
  assert.equal(received, payload);
  assert.equal(Object.hasOwn(payload, "audio_only"), false);
});

type NativeArgs = { readonly video_id: string; audio_only?: boolean };
type NativeConfig = { readonly args: NativeArgs };
const argsPrototype = { nativeKind: "player vars" };
const configPrototype = { nativeKind: "player config" };
const nativeField = Symbol("native field");
const nativeDescriptor = {
  value: "native data",
  writable: false,
  enumerable: false,
  configurable: false,
};

void test("enabling audio preserves native configuration and argument descriptors", () => {
  const args: NativeArgs = { video_id: videoId };
  const config: NativeConfig = { args };
  Object.setPrototypeOf(args, argsPrototype);
  Object.setPrototypeOf(config, configPrototype);
  Object.defineProperty(args, nativeField, nativeDescriptor);
  Object.defineProperty(config, nativeField, nativeDescriptor);
  const application = {
    create(_element: null, value: NativeConfig): NativeConfig {
      return value;
    },
  };
  install(application);
  const received = application.create(null, config);
  assert.equal(received.args.audio_only, true);
  assert.equal(Object.getPrototypeOf(received), configPrototype);
  assert.equal(Object.getPrototypeOf(received.args), argsPrototype);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(received, nativeField),
    nativeDescriptor,
  );
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(received.args, nativeField),
    nativeDescriptor,
  );
});

void test("enabling audio preserves native transport payload descriptors", () => {
  const args: NativeArgs = { video_id: videoId };
  Object.setPrototypeOf(args, argsPrototype);
  Object.defineProperty(args, nativeField, nativeDescriptor);
  const player = {
    loadVideoByPlayerVars(payload: NativeArgs): NativeArgs {
      return payload;
    },
  };
  const application = { create: () => player };
  install(application);
  application.create();
  const received = player.loadVideoByPlayerVars(args);
  assert.equal(received.audio_only, true);
  assert.equal(Object.getPrototypeOf(received), argsPrototype);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(received, nativeField),
    nativeDescriptor,
  );
});

function nativePlayer() {
  return {
    preloadVideoByPlayerVars(args: NativeArgs): boolean | undefined {
      return args.audio_only;
    },
    cueVideoByPlayerVars(args: NativeArgs): boolean | undefined {
      return args.audio_only;
    },
    loadVideoByPlayerVars(args: NativeArgs): boolean | undefined {
      return args.audio_only;
    },
  };
}

void test("an audio preload only affects the player that performed it", () => {
  const first = nativePlayer();
  const second = nativePlayer();
  const application = { create: (player: typeof first) => player };
  const disableAudio = install(application);
  application.create(first);
  application.create(second);
  assert.equal(first.preloadVideoByPlayerVars({ video_id: videoId }), true);
  disableAudio();
  const otherMode = second.loadVideoByPlayerVars({ video_id: videoId });
  const preloadedMode = first.loadVideoByPlayerVars({ video_id: videoId });
  assert.deepEqual([otherMode, preloadedMode], [undefined, false]);
});

for (const hostname of ["www.youtube.com", "m.youtube.com"]) {
  void test(`${hostname} restores video when the native player reuses an audio preload`, () => {
    const preloads = new Map<string, boolean>();
    const player = {
      preloadVideoByPlayerVars(args: NativeArgs): void {
        if (!preloads.has(args.video_id))
          preloads.set(args.video_id, args.audio_only === true);
      },
      loadVideoByPlayerVars(args: NativeArgs): boolean | undefined {
        return args.audio_only ?? preloads.get(args.video_id);
      },
    };
    const application = { create: () => player };
    const disableAudio = install(application, true, undefined, hostname);
    application.create();
    player.preloadVideoByPlayerVars({ video_id: videoId });
    disableAudio();
    player.preloadVideoByPlayerVars({ video_id: videoId });

    assert.equal(preloads.get(videoId), true);
    assert.equal(player.loadVideoByPlayerVars({ video_id: videoId }), false);
  });
}

void test("a long-lived player can restore video from older preloads with bounded tracking", () => {
  const count = 8192;
  const entryLimit = 512;
  let peakEntries = 0;
  class MeasuredSet<T> extends Set<T> {
    override add(value: T): this {
      super.add(value);
      if (typeof value === "string" && value.startsWith("stress")) {
        peakEntries = Math.max(peakEntries, this.size);
      }
      return this;
    }
  }
  const first = nativePlayer();
  const second = nativePlayer();
  const application = { create: (player: typeof first) => player };
  const disableAudio = install(application, true, MeasuredSet);
  application.create(first);
  application.create(second);
  for (let index = 0; index < count; index++) {
    const id = `stress${String(index).padStart(5, "0")}`;
    assert.equal(first.preloadVideoByPlayerVars({ video_id: id }), true);
  }
  disableAudio();
  assert.equal(first.cueVideoByPlayerVars({ video_id: "stress00000" }), false);
  assert.equal(first.loadVideoByPlayerVars({ video_id: "stress00000" }), false);
  assert.equal(first.loadVideoByPlayerVars({ video_id: "stress08191" }), false);
  assert.equal(
    second.loadVideoByPlayerVars({ video_id: "stress00000" }),
    undefined,
  );
  assert.ok(
    peakEntries <= entryLimit,
    `Retained ${peakEntries} preload IDs, expected at most ${entryLimit}`,
  );
});

void test("a stock load that cannot override audio leaves the preload available for the next load", () => {
  const player = {
    preloadVideoByPlayerVars(args: NativeArgs): boolean | undefined {
      return args.audio_only;
    },
    loadVideoByPlayerVars(args: NativeArgs): NativeArgs {
      return args;
    },
  };
  const application = { create: () => player };
  const disableAudio = install(application);
  application.create();
  assert.equal(player.preloadVideoByPlayerVars({ video_id: videoId }), true);
  disableAudio();
  const frozen = Object.freeze({ video_id: videoId });
  assert.equal(player.loadVideoByPlayerVars(frozen), frozen);
  assert.equal(
    player.loadVideoByPlayerVars({ video_id: videoId }).audio_only,
    false,
  );
  assert.equal(
    player.loadVideoByPlayerVars({ video_id: videoId }).audio_only,
    undefined,
  );
});
