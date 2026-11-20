import { createSignal, onSettled } from "solid-js";

/** A media query as a signal, cleaned up with its owner. */
export function useMedia(query: string) {
  const mql = matchMedia(query);
  const [matches, setMatches] = createSignal(mql.matches);
  onSettled(() => {
    const on = () => setMatches(mql.matches);
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  });
  return matches;
}
