import { app, mobile, navigation, ready } from "./dom.ts";

const flag = "canAutoAdvance_";

type Suppression = { maintain(): boolean; restore?(): void };

function playlistWatch(): boolean {
  return (
    location.pathname === "/watch" &&
    Boolean(new URLSearchParams(location.search).get("list"))
  );
}

function attempt<T>(run: () => T): T | undefined {
  try {
    return run();
  } catch {
    return undefined;
  }
}

function read(owner: object, key: string): unknown {
  return attempt<unknown>(() => Reflect.get(owner, key));
}

function seekingAudioEnd(media: HTMLVideoElement): boolean {
  const remaining = media.duration - media.currentTime;
  return (
    media.seeking &&
    !media.paused &&
    !media.ended &&
    media.videoWidth === 0 &&
    media.currentTime > 1 &&
    remaining >= 0 &&
    remaining < 1
  );
}

function recoverTerminalAudioSeek(): void {
  const attempted = new WeakMap<HTMLVideoElement, string>();
  let pending: number | undefined;
  function reset(event: Event): void {
    const media = event.target;
    if (media instanceof HTMLVideoElement && !media.seeking)
      attempted.delete(media);
  }
  document.addEventListener("seeked", reset, true);
  document.addEventListener("emptied", reset, true);
  document.addEventListener(
    "seeking",
    (event) => {
      const media = event.target;
      if (!(media instanceof HTMLVideoElement)) return;
      const player = media.closest("#movie_player");
      if (!player || player.querySelector("video") !== media) return;
      if (pending !== undefined) {
        window.clearTimeout(pending);
        pending = undefined;
      }
      if (
        !playlistWatch() ||
        !seekingAudioEnd(media) ||
        player.classList.contains("ad-showing")
      )
        return;
      const url = location.href;
      if (attempted.get(media) === url) return;
      const time = media.currentTime;
      pending = window.setTimeout(() => {
        pending = undefined;
        if (
          url !== location.href ||
          !media.isConnected ||
          player.querySelector("video") !== media ||
          player.classList.contains("ad-showing") ||
          media.currentTime !== time ||
          media.readyState >= media.HAVE_CURRENT_DATA ||
          !seekingAudioEnd(media)
        )
          return;
        const state = read(player, "getPlayerState");
        const seek = read(player, "seekTo");
        if (typeof state !== "function" || typeof seek !== "function") return;
        attempt(() => {
          if (Reflect.apply(state, player, []) !== 0) return;
          attempted.set(media, url);
          Reflect.apply(seek, player, [time - 1, true]);
        });
      }, 250);
    },
    true,
  );
}

function preventAdvance(owner: unknown): Suppression | undefined {
  if (!owner || typeof owner !== "object") return;
  const initial = read(owner, flag);
  if (typeof initial !== "boolean") return;
  const original = attempt(() => Object.getOwnPropertyDescriptor(owner, flag));
  if (original?.configurable && original.writable) {
    let value: unknown = initial;
    const get = () => (playlistWatch() ? false : value);
    const installed = attempt(() =>
      Reflect.defineProperty(owner, flag, {
        configurable: true,
        enumerable: original.enumerable ?? false,
        get,
        set(next: unknown) {
          value = next;
        },
      }),
    );
    if (installed) {
      const maintain = () =>
        attempt(() => Object.getOwnPropertyDescriptor(owner, flag))?.get ===
        get;
      return {
        maintain,
        restore() {
          if (maintain())
            Reflect.defineProperty(owner, flag, { ...original, value });
        },
      };
    }
  }

  let suppressed = false;
  const maintain = (): boolean => {
    const value = read(owner, flag);
    if (value === false) return true;
    if (
      value !== true ||
      attempt(() => Reflect.set(owner, flag, false)) !== true ||
      read(owner, flag) !== false
    )
      return false;
    suppressed = true;
    return true;
  };
  if (!maintain()) return;
  return {
    maintain,
    restore() {
      if (!suppressed || read(owner, flag) !== false) return;
      if (
        !original &&
        Object.getOwnPropertyDescriptor(owner, flag)?.value === false
      )
        Reflect.deleteProperty(owner, flag);
      else Reflect.set(owner, flag, true);
    },
  };
}

function preventNativeAdvance(manager: Element): Suppression | undefined {
  const native = read(manager, "TEST_ONLY");
  if (!native || typeof native !== "object") return;
  const setter = read(native, "setCanAutoAdvance");
  if (typeof setter !== "function") return;
  const getter = read(native, "getCanAutoAdvance");
  const readNativeState =
    typeof getter === "function"
      ? () => attempt<unknown>(() => Reflect.apply(getter, native, []))
      : undefined;
  const readManagerState = () => read(manager, flag);
  const write = (value: boolean) =>
    attempt(() => {
      Reflect.apply(setter, native, [value]);
      return true;
    }) === true;
  let applied = false;
  let readSuppressedState: (() => unknown) | undefined;

  function suppress(): boolean {
    const nativeState = readNativeState?.();
    const readState =
      typeof nativeState === "boolean" && readNativeState
        ? readNativeState
        : readManagerState;
    const previous =
      typeof nativeState === "boolean" ? nativeState : readManagerState();
    if (applied && previous === false) return true;
    if (!write(false)) return false;
    const current = readState();
    if (
      current !== false &&
      (typeof previous === "boolean" || current === true)
    )
      return false;
    if (previous === true && current === false) readSuppressedState = readState;
    applied = true;
    return true;
  }

  if (!suppress()) return;
  return {
    maintain() {
      return (
        read(manager, "TEST_ONLY") === native &&
        read(native, "setCanAutoAdvance") === setter &&
        suppress()
      );
    },
    restore() {
      if (readSuppressedState?.() === false) write(true);
    },
  };
}

function desktop(root: Element): void {
  let manager: Element | null = null;
  let controller: unknown;
  let suppression: Suppression | undefined;
  let watching = false;
  const observer = new MutationObserver((records) => {
    if (
      !suppression ||
      records.some(({ addedNodes, removedNodes }) =>
        [...addedNodes, ...removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches("yt-playlist-manager") ||
              Boolean(node.querySelector("yt-playlist-manager"))),
        ),
      )
    )
      check();
  });

  function restore(): void {
    const previous = suppression;
    suppression = undefined;
    attempt(() => previous?.restore?.());
  }

  function check(): void {
    if (!playlistWatch()) {
      observer.disconnect();
      watching = false;
      restore();
      manager = null;
      controller = undefined;
      return;
    }
    if (!watching) {
      observer.observe(root, { subtree: true, childList: true });
      watching = true;
    }
    const nextManager =
      root.querySelector("yt-playlist-manager") ??
      document.querySelector("yt-playlist-manager");
    const nextController = nextManager
      ? read(nextManager, "polymerController")
      : undefined;
    if (
      nextManager === manager &&
      nextController === controller &&
      suppression?.maintain()
    )
      return;
    restore();
    manager = nextManager;
    controller = nextController;
    if (manager)
      suppression =
        preventAdvance(controller) ??
        preventNativeAdvance(manager) ??
        preventAdvance(manager);
  }

  navigation(check);
  window.addEventListener("yt-navigate-finish", (event) => {
    if (event.eventPhase === Event.AT_TARGET) check();
  });
  document.addEventListener("ended", check, true);
  void customElements.whenDefined("yt-playlist-manager").then(check);
  check();
}

export function playlist(): void {
  recoverTerminalAudioSeek();
  if (!mobile) {
    ready(() => app(desktop));
    return;
  }
  window.addEventListener(
    "player-state-change",
    (event) => {
      const detail: unknown = "detail" in event ? event.detail : undefined;
      if (
        detail &&
        typeof detail === "object" &&
        "state" in detail &&
        detail.state === 0 &&
        playlistWatch()
      )
        event.stopImmediatePropagation();
    },
    true,
  );
}
