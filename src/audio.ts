import { enabled } from "./state.ts";

const objectConstructorSource = Function.prototype.toString.call(Object);
const maxAudioPreloads = 256;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown): value is object {
  return !!value && (typeof value === "object" || typeof value === "function");
}

function withProperty(
  source: object,
  key: "args" | "audio_only",
  value: unknown,
): object | undefined {
  const prototype = Reflect.getPrototypeOf(source);
  const constructor =
    prototype && Object.getOwnPropertyDescriptor(prototype, "constructor");
  if (constructor) {
    const nativeConstructor: unknown = constructor.value;
    if (
      typeof nativeConstructor !== "function" ||
      Function.prototype.toString.call(nativeConstructor) !==
        objectConstructorSource
    )
      return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  const extensible = Object.isExtensible(source);
  if (
    descriptor ? !descriptor.writable : !extensible || Reflect.has(source, key)
  )
    return;
  const descriptors = Object.getOwnPropertyDescriptors(source);
  descriptors[key] = descriptor
    ? { ...descriptor, value }
    : { configurable: true, enumerable: true, writable: true, value };
  const copy = Object.defineProperties({}, descriptors);
  Object.setPrototypeOf(copy, prototype);
  return extensible ? copy : Object.preventExtensions(copy);
}

type Callable = (this: unknown, ...args: unknown[]) => unknown;

function callable(value: unknown): value is Callable {
  return typeof value === "function";
}

export function audio(): void {
  const patches = new WeakMap<object, Set<string>>();
  const wrappers = new WeakSet<object>();
  const audioPreloads = new WeakMap<object, Set<string> | true>();

  function intercept(
    owner: unknown,
    key: string,
    transform: (value: unknown) => unknown,
  ): void {
    if (!object(owner)) return;
    const previous = patches.get(owner);
    if (previous?.has(key)) return;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (
        descriptor &&
        (!descriptor.configurable ||
          !("value" in descriptor) ||
          descriptor.writable === false)
      )
        return;
      let inherited: PropertyDescriptor | undefined;
      if (!descriptor && Reflect.has(owner, key)) {
        const visited = new Set([owner]);
        let prototype = Reflect.getPrototypeOf(owner);
        while (prototype && !inherited) {
          if (visited.has(prototype)) return;
          visited.add(prototype);
          inherited = Object.getOwnPropertyDescriptor(prototype, key);
          if (!inherited) prototype = Reflect.getPrototypeOf(prototype);
        }
        if (!inherited?.writable) return;
      }
      let value: unknown = transform(Reflect.get(owner, key));
      Object.defineProperty(owner, key, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? inherited?.enumerable ?? true,
        get: () => value,
        set(next: unknown) {
          value = transform(next);
        },
      });
      const keys = previous ?? new Set<string>();
      keys.add(key);
      patches.set(owner, keys);
    } catch {}
  }

  function wrap(
    value: unknown,
    apply: (
      target: Callable,
      receiver: unknown,
      argumentsList: unknown[],
    ) => unknown,
  ): unknown {
    if (!callable(value) || wrappers.has(value)) return value;
    const wrapped = new Proxy(value, { apply });
    wrappers.add(wrapped);
    return wrapped;
  }

  function transport(player: unknown): void {
    for (const method of [
      "loadVideoByPlayerVars",
      "cueVideoByPlayerVars",
      "preloadVideoByPlayerVars",
    ] as const) {
      intercept(player, method, (original) =>
        wrap(original, (target, receiver, args) => {
          const owner = object(receiver) ? receiver : undefined;
          const preloads = owner && audioPreloads.get(owner);
          const saturated = preloads === true;
          const tracked = saturated ? undefined : preloads;
          const preload = method === "preloadVideoByPlayerVars";
          const current = enabled("audioOnly");
          const rememberPreload = preload && current;
          let videoId: string | undefined;
          let parameters = args;
          if (current || preloads) {
            try {
              const params = args[0];
              if (record(params)) {
                if (
                  !saturated &&
                  (rememberPreload || (!preload && tracked?.size))
                ) {
                  const nativeId = params["video_id"];
                  const id =
                    typeof nativeId === "string" ? nativeId : params["videoId"];
                  if (typeof id === "string") videoId = id;
                }
                if (
                  current ||
                  saturated ||
                  (videoId && tracked?.has(videoId))
                ) {
                  const updated = withProperty(params, "audio_only", current);
                  if (updated) parameters = [updated, ...args.slice(1)];
                }
              }
            } catch {}
          }
          const result: unknown = Reflect.apply(target, receiver, parameters);
          if (!owner || !videoId) return result;
          const currentPreloads = audioPreloads.get(owner);
          if (currentPreloads === true) return result;
          if (rememberPreload && parameters !== args) {
            if (!currentPreloads) {
              audioPreloads.set(owner, new Set([videoId]));
            } else if (
              currentPreloads.size < maxAudioPreloads ||
              currentPreloads.has(videoId)
            ) {
              currentPreloads.add(videoId);
            } else {
              audioPreloads.set(owner, true);
            }
          } else if (
            !current &&
            method === "loadVideoByPlayerVars" &&
            parameters !== args
          ) {
            if (currentPreloads?.delete(videoId) && !currentPreloads.size)
              audioPreloads.delete(owner);
          }
          return result;
        }),
      );
    }
  }

  intercept(unsafeWindow, "yt", (yt) => {
    intercept(yt, "player", (player) => {
      intercept(player, "Application", (application) => {
        for (const method of ["create", "createAlternate"]) {
          intercept(application, method, (original) =>
            wrap(original, (target, receiver, args) => {
              const config = args[1];
              let parameters = args;
              if (enabled("audioOnly")) {
                try {
                  if (record(config)) {
                    const supplied: unknown = Object.getOwnPropertyDescriptor(
                      config,
                      "args",
                    )?.value;
                    if (record(supplied)) {
                      const payload = withProperty(
                        supplied,
                        "audio_only",
                        true,
                      );
                      const updated =
                        payload && withProperty(config, "args", payload);
                      if (updated)
                        parameters = [args[0], updated, ...args.slice(2)];
                    }
                  }
                } catch {}
              }
              const result: unknown = Reflect.apply(
                target,
                receiver,
                parameters,
              );
              transport(result);
              return result;
            }),
          );
        }
        return application;
      });
      return player;
    });
    return yt;
  });
}
