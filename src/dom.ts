export const mobile = location.hostname === "m.youtube.com";
const selector = mobile ? "ytm-app" : "ytd-app";

export function ready(run: () => void): void {
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
}

export function app(run: (root: Element) => void): void {
  const element = document.querySelector(selector);
  if (element) {
    run(element);
    return;
  }
  const observer = new MutationObserver(() => {
    const current = document.querySelector(selector);
    if (!current) return;
    observer.disconnect();
    window.clearTimeout(deadline);
    run(current);
  });
  const deadline = window.setTimeout(() => observer.disconnect(), 12000);
  observer.observe(document.body, { subtree: true, childList: true });
}

export function navigation(run: () => void): void {
  if (mobile) {
    for (const event of ["state-navigateend", "updateui", "popstate"])
      window.addEventListener(event, run);
  } else {
    for (const event of ["yt-navigate-finish", "yt-page-type-changed"])
      document.addEventListener(event, run, true);
    window.addEventListener("popstate", run);
  }
}

export function visible(element: Element): boolean {
  return (
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden"
  );
}

export function svg(path: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const graphic = document.createElementNS(ns, "svg");
  graphic.setAttribute("viewBox", "0 0 24 24");
  graphic.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS(ns, "path");
  shape.setAttribute("d", path);
  graphic.append(shape);
  return graphic;
}

export function activation(
  button: HTMLButtonElement,
  action: () => void,
): void {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) action();
  });
}
