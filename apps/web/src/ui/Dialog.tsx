import { onSettled, Show } from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
import styles from "./Dialog.module.css";

/**
 * A centered modal over a soft backdrop. The X (top right), Esc or a click
 * outside closes it,
 * focus moves into it on open and back to whatever had it on close.
 */
export function Dialog(props: {
  open: boolean;
  onClose: () => void;
  label: string;
  size?: "sm" | "md";
  children: JSX.Element;
}) {
  return (
    <Show when={props.open}>
      <Portal mount={document.body}>
        <DialogBody {...props} />
      </Portal>
    </Show>
  );
}

function DialogBody(props: {
  onClose: () => void;
  label: string;
  size?: "sm" | "md";
  children: JSX.Element;
}) {
  let panel!: HTMLElement;
  onSettled(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Prefer the marked or first real control over the close button.
    const first =
      panel.querySelector<HTMLElement>("[autofocus]") ??
      panel.querySelector<HTMLElement>("input, select, button:not([aria-label='Close'])");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    addEventListener("keydown", onKey, true);
    return () => {
      removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  });
  return (
    <div class={styles.backdrop} onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <section
        ref={panel}
        class={styles.panel}
        data-size={props.size ?? "md"}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
      >
        {props.children}
        <button
          type="button"
          class={["icon-btn", styles.close]}
          aria-label="Close"
          onClick={() => props.onClose()}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </button>
      </section>
    </div>
  );
}
