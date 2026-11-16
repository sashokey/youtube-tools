import { enabled } from './state.ts';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function object(value: unknown): value is object {
  return !!value && (typeof value === 'object' || typeof value === 'function');
}

type Callable = (this: unknown, ...args: unknown[]) => unknown;

function callable(value: unknown): value is Callable {
  return typeof value === 'function';
}

export function audio(): void {
  const patches = new WeakMap<object, Set<string>>();
  const wrappers = new WeakSet<object>();
  const audioPreloads = new Set<string>();

  function intercept(owner: unknown, key: string, transform: (value: unknown) => unknown): void {
    if (!object(owner)) return;
    const previous = patches.get(owner);
    if (previous?.has(key)) return;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (descriptor && (!descriptor.configurable || !('value' in descriptor) || descriptor.writable === false)) return;
      let value: unknown = transform(Reflect.get(owner, key));
      Object.defineProperty(owner, key, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get: () => value,
        set(next: unknown) { value = transform(next); },
      });
      const keys = previous ?? new Set<string>();
      keys.add(key);
      patches.set(owner, keys);
    } catch {}
  }

  function wrap(value: unknown, apply: (target: Callable, receiver: unknown, argumentsList: unknown[]) => unknown): unknown {
    if (!callable(value) || wrappers.has(value)) return value;
    const wrapped = new Proxy(value, { apply });
    wrappers.add(wrapped);
    return wrapped;
  }

  function transport(player: unknown): void {
    for (const method of ['loadVideoByPlayerVars', 'cueVideoByPlayerVars', 'preloadVideoByPlayerVars'] as const) {
      intercept(player, method, original => wrap(original, (target, receiver, args) => {
        const params = args[0];
        if (!record(params)) return Reflect.apply(target, receiver, args);
        const id = typeof params['video_id'] === 'string' ? params['video_id'] : params['videoId'];
        const videoId = typeof id === 'string' ? id : '';
        const current = enabled('audioOnly');
        if (method === 'preloadVideoByPlayerVars' && videoId) {
          if (current) audioPreloads.add(videoId);
          else audioPreloads.delete(videoId);
        }
        const audioWasPreloaded = method !== 'preloadVideoByPlayerVars' && audioPreloads.has(videoId);
        if (method === 'loadVideoByPlayerVars') audioPreloads.delete(videoId);
        return Reflect.apply(target, receiver, current || audioWasPreloaded
          ? [{ ...params, audio_only: current }, ...args.slice(1)]
          : args);
      }));
    }
  }

  intercept(unsafeWindow, 'yt', yt => {
    intercept(yt, 'player', player => {
      intercept(player, 'Application', application => {
        for (const method of ['create', 'createAlternate']) {
          intercept(application, method, original => wrap(original, (target, receiver, args) => {
            const config = args[1];
            let parameters = args;
            if (enabled('audioOnly') && record(config)) {
              const supplied = config['args'];
              if (record(supplied)) parameters = [args[0], { ...config, args: { ...supplied, audio_only: true } }, ...args.slice(2)];
            }
            const result: unknown = Reflect.apply(target, receiver, parameters);
            transport(result);
            return result;
          }));
        }
        return application;
      });
      return player;
    });
    return yt;
  });
}
