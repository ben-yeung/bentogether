import type { JSX } from "@solidjs/web";
import { navigate } from "../lib/router";
import styles from "./Logo.module.css";

/**
 * The mark: a top-down bento box, four unequal compartments, one in shu.
 * See docs/BRAND.md → Logo.
 */
export function Mark(props: { size?: number; mono?: boolean }) {
  return (
    <svg
      class={[styles.mark, { [styles.mono!]: !!props.mono }]}
      width={props.size ?? 28}
      height={props.size ?? 28}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="30" height="30" rx="8" class={styles.frame} />
      <rect x="5" y="5" width="13" height="10" rx="3" class={styles.shu} />
      <rect x="20" y="5" width="7" height="10" rx="3" class={styles.cell} />
      <rect x="5" y="17" width="7" height="10" rx="3" class={styles.cell} />
      <rect x="14" y="17" width="13" height="10" rx="3" class={styles.cell} />
    </svg>
  );
}

/** "benTogether", with "benTo" underlined by a shu rule. */
export function Wordmark(props: { size?: "md" | "lg" }) {
  return (
    <span class={styles.wordmark} data-size={props.size ?? "md"} aria-label="benTogether">
      <span class={styles.bento} aria-hidden="true">
        benTo
      </span>
      <span aria-hidden="true">gether</span>
    </span>
  );
}

export function Lockup(props: { size?: "md" | "lg" }) {
  return (
    <span class={styles.lockup} data-size={props.size ?? "md"}>
      <Mark size={props.size === "lg" ? 52 : 28} />
      <Wordmark size={props.size ?? "md"} />
    </span>
  );
}

/** Wraps a logo so clicking it goes back to the home page, without a reload. */
export function HomeLink(props: { children: JSX.Element; class?: string }) {
  return (
    <a
      href="/"
      class={[styles.homeLink, props.class]}
      aria-label="benTogether home"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate("/");
      }}
    >
      {props.children}
    </a>
  );
}
