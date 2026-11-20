import { createSignal } from "solid-js";

/**
 * Two routes don't need a router package: a signal for the path, kept in
 * sync with history. Vercel rewrites every path to index.html.
 */
const [path, setPath] = createSignal(location.pathname);

addEventListener("popstate", () => setPath(location.pathname));

export { path };

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname) return;
  history[opts.replace ? "replaceState" : "pushState"](null, "", to);
  setPath(to);
}

export type Route = { name: "home" } | { name: "box"; id: string } | { name: "missing" };

export function matchRoute(p: string): Route {
  if (p === "/" || p === "") return { name: "home" };
  const box = /^\/b\/([a-z0-9]{8,24})\/?$/.exec(p);
  if (box) return { name: "box", id: box[1]! };
  return { name: "missing" };
}
