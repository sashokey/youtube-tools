export type Setting = "showWatched" | "audioOnly";

const settings: Record<Setting, boolean> = {
  showWatched: false,
  audioOnly: false,
};
const subscribers: Record<Setting, Set<() => void>> = {
  showWatched: new Set(),
  audioOnly: new Set(),
};

function update(key: Setting, value: unknown): void {
  if (typeof value !== "boolean" || settings[key] === value) return;
  settings[key] = value;
  subscribers[key].forEach((listener) => listener());
}

export function initializePreferences(): void {
  for (const key of ["showWatched", "audioOnly"] as const) {
    try {
      update(key, GM_getValue<unknown>(key, false));
      GM_addValueChangeListener<unknown>(key, (_key, _before, value) =>
        update(key, value),
      );
    } catch {}
  }
}

export function enabled(key: Setting): boolean {
  return settings[key];
}

export function flip(key: Setting): void {
  const value = !settings[key];
  try {
    GM_setValue(key, value);
    update(key, value);
  } catch {}
}

export function listen(key: Setting, run: () => void): void {
  subscribers[key].add(run);
}
