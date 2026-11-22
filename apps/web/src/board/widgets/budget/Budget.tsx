import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { CURRENCIES, SYSTEM_AUTHOR, WIDGET_TITLE_MAX, type BudgetChange } from "@bentogether/shared";
import { personVars } from "../../../lib/identity";
import { editableAmount, formatMoney, parseAmount } from "../../../lib/money";
import { ColorTools } from "../../frame/ColorTools";
import { WidgetFrame, frameParts, type WidgetProps } from "../../frame/WidgetFrame";
import { Select } from "../../../ui/Select";
import styles from "./Budget.module.css";

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c, label: c }));

/** Budgets this many columns wide or narrower fold the swatches into one dot. */
const COMPACT_TOOLS_MAX_W = 3;

/**
 * What's left to spend, shared. The big number is the total; tap it to set
 * a new one. Under it, type an amount and press − or + (Enter subtracts).
 * Each is sent as a change, so two people at once both count. The history
 * button in the tools flips the widget to a log of who changed it.
 */
export function Budget(props: WidgetProps) {
  const s = () => props.session;
  const fail = (err: Error) => props.onError(err.message);
  const change = (c: BudgetChange) => s().changeBudget(props.id, c).catch(fail);

  const state = createMemo(() => s().budget(props.id));
  const currency = () => state().currency;
  const money = (n: number, signed = false) => formatMoney(n, currency(), { signed });

  const author = createMemo(() => {
    const by = s().widget(props.id)?.createdBy ?? "";
    return by === SYSTEM_AUTHOR ? "bento" : by;
  });
  const title = () => s().listTitle(props.id);

  // ------------------------------------------------------------- title

  const [titleDraft, setTitleDraft] = createSignal<string | null>(null);

  function commitTitle() {
    const next = titleDraft();
    setTitleDraft(null);
    s().setPresence({ action: null });
    if (next === null || next.trim() === title()) return;
    s().setListTitle(props.id, next.trim()).catch(fail);
  }

  // ------------------------------------------------- set the total

  /** Your draft while you type a new total. Others' clicks keep moving the number underneath. */
  const [totalDraft, setTotalDraft] = createSignal<string | null>(null);

  function startSet() {
    if (props.readOnly) return;
    setTotalDraft(editableAmount(state().amount, currency()));
    s().setPresence({ action: "typing" });
  }

  /**
   * True from a click elsewhere closing the field until that click lands,
   * so the same click doesn't open the field again on the widget.
   */
  let closingClick = false;
  let closingByKey = false;

  function swallowClosingClick() {
    closingClick = true;
    const done = () => {
      closingClick = false;
      removeEventListener("click", done);
      removeEventListener("pointerdown", done, true);
    };
    // The click arrives at the window after the widget has seen it; a
    // later pointerdown clears it too, in case no click followed (tabbing away).
    addEventListener("click", done);
    addEventListener("pointerdown", done, true);
  }

  function activate() {
    if (closingClick) return;
    startSet();
  }

  /** Saves the new total when the field closes; no change, no op. */
  function commitSet() {
    const draft = totalDraft();
    if (draft === null) return;
    if (!closingByKey) swallowClosingClick();
    closingByKey = false;
    setTotalDraft(null);
    s().setPresence({ action: null });
    if (draft.trim() === "") return;
    const parsed = parseAmount(draft, currency());
    if (!parsed) {
      props.onError("That isn't an amount.");
      return;
    }
    const to = parsed.sign === "-" ? -parsed.hundredths : parsed.hundredths;
    if (to !== state().amount) void change({ do: "set", to });
  }

  // ------------------------------------------------- spend or add

  /**
   * The amount you're about to apply. It clears after − or +, so a second
   * click can't spend it twice by accident; focus goes back to the field.
   */
  const [amountDraft, setAmountDraft] = createSignal("");
  let amountField: HTMLInputElement | undefined;

  /** Applies the typed amount; a sign you type wins over the button you pressed. */
  function apply(sign: "-" | "+") {
    const text = amountDraft();
    if (text.trim() === "") {
      amountField?.focus();
      return;
    }
    const parsed = parseAmount(text, currency());
    if (!parsed || parsed.hundredths === 0) {
      props.onError("That isn't an amount.");
      return;
    }
    const negative = (parsed.sign ?? sign) === "-";
    setAmountDraft("");
    amountField?.focus();
    void change({ do: "adjust", by: negative ? -parsed.hundredths : parsed.hundredths });
  }

  /** Focus the field once it's in the page. */
  function focusOnMount(el: HTMLInputElement) {
    setTimeout(() => {
      el.focus();
      el.select();
    }, 0);
  }

  // ---------------------------------------------------------- history

  /** Flipping to the history is yours alone; nobody else's view changes. */
  const [showHistory, setShowHistory] = createSignal(false);

  const amountText = createMemo(() => money(state().amount));
  const caption = () => (state().amount < 0 ? "over budget" : "left to spend");

  return (
    <WidgetFrame
      {...props}
      kind="budget"
      class={styles.budget}
      color={s().color(props.id)}
      label={`Budget by ${author()}: ${title() || "untitled"}, ${amountText()} ${caption()}`}
      deleteLabel="Delete budget"
      onActivate={props.readOnly || showHistory() ? undefined : activate}
    >
      <div class={styles.head}>
        <input
          class={styles.title}
          value={titleDraft() ?? title()}
          size={Math.max(
            2,
            ((titleDraft() ?? title()) || (props.readOnly ? "Budget" : "Name this budget")).length,
          )}
          placeholder={props.readOnly ? "Budget" : "Name this budget"}
          maxlength={WIDGET_TITLE_MAX}
          aria-label="Budget title"
          readonly={props.readOnly}
          onFocus={() => {
            if (props.readOnly) return;
            setTitleDraft(title());
            s().setPresence({ action: "typing" });
          }}
          onInput={(e) => void setTitleDraft(e.currentTarget.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setTitleDraft(null);
              e.currentTarget.blur();
            }
          }}
        />
      </div>

      <Show
        when={showHistory()}
        fallback={
          <div class={styles.stage} data-over={state().amount < 0}>
            <div class={styles.total}>
              <div class={styles.line}>
                <Switch>
                  <Match when={totalDraft() !== null}>
                    <input
                      ref={focusOnMount}
                      class={[styles.amount, styles.amountInput]}
                      style={{ "--chars": Math.max(4, totalDraft()!.length + 1) }}
                      value={totalDraft()!}
                      inputmode="decimal"
                      aria-label={`New amount in ${currency()}`}
                      onInput={(e) => void setTotalDraft(e.currentTarget.value)}
                      onBlur={commitSet}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          closingByKey = true;
                          e.currentTarget.blur();
                        }
                        if (e.key === "Escape") {
                          setTotalDraft(null);
                          s().setPresence({ action: null });
                        }
                      }}
                    />
                  </Match>
                  <Match when={props.readOnly}>
                    <span class={styles.amount} style={{ "--chars": amountText().length }}>
                      {amountText()}
                    </span>
                  </Match>
                  <Match when={!props.readOnly}>
                    <button
                      type="button"
                      class={[styles.amount, styles.amountBtn]}
                      style={{ "--chars": amountText().length }}
                      aria-label={`${amountText()} ${caption()}. Set the amount`}
                      title="Set the amount"
                      onClick={activate}
                    >
                      {amountText()}
                    </button>
                  </Match>
                </Switch>
                {/* In two parts, so a caption beside the amount can stack them. */}
                <span class={styles.caption}>
                  <span>{caption().split(" ")[0]}</span>{" "}
                  <span>{caption().split(" ").slice(1).join(" ")}</span>
                </span>
              </div>
            </div>

            <Show when={!props.readOnly}>
              <form
                class={styles.adjust}
                onSubmit={(e) => {
                  e.preventDefault();
                  apply("-");
                }}
              >
                <button
                  type="button"
                  class={styles.nudge}
                  aria-label="Subtract"
                  title="Subtract"
                  onClick={() => apply("-")}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.5 8h9" />
                  </svg>
                </button>
                <input
                  ref={(el) => (amountField = el)}
                  class={styles.adjustInput}
                  value={amountDraft()}
                  placeholder="Amount"
                  inputmode="decimal"
                  aria-label="Amount to add or subtract"
                  onInput={(e) => void setAmountDraft(e.currentTarget.value)}
                  onFocus={(e) => {
                    e.currentTarget.select();
                    s().setPresence({ action: "typing" });
                  }}
                  onBlur={() => s().setPresence({ action: null })}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") e.currentTarget.blur();
                  }}
                />
                <button
                  type="button"
                  class={styles.nudge}
                  aria-label="Add"
                  title="Add"
                  onClick={() => apply("+")}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.5 8h9M8 3.5v9" />
                  </svg>
                </button>
              </form>
            </Show>
          </div>
        }
      >
        <div class={styles.history}>
          <p class={styles.historyTotal} data-over={state().amount < 0}>
            <span class={styles.historyAmount}>{amountText()}</span>{" "}
            <span class={styles.caption}>{caption()}</span>
          </p>
          <Show when={state().log.length > 0} fallback={<p class={styles.empty}>No changes yet.</p>}>
            <ol class={styles.log} data-scroll aria-label="Recent changes">
              <For each={state().log}>
                {(entry) => (
                  <li class={styles.logEntry} style={personVars(entry.hue)}>
                    <span class={styles.who}>{entry.by}</span>
                    <span class={styles.what}>
                      {entry.do === "set" ? `set to ${money(entry.amount)}` : money(entry.amount, true)}
                    </span>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </div>
      </Show>

      <footer class={frameParts.meta}>
        <span class={frameParts.byline}>by {author()}</span>
        {/* Kept in view while the history is open, so you can flip back. */}
        <div class={[frameParts.tools, { [frameParts.toolsPinned!]: showHistory() }]} data-intent="tools">
          <button
            type="button"
            class={styles.historyBtn}
            aria-pressed={showHistory() ? "true" : "false"}
            aria-label={showHistory() ? "Hide history" : "Show history"}
            title={showHistory() ? "Hide history" : "History"}
            onClick={() => {
              setTotalDraft(null);
              setShowHistory((on) => !on);
            }}
          >
            {/* A clock with an arrow winding back. */}
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.85M2.6 2.9v2.4H5M8 5.1V8l2 1.3" />
            </svg>
          </button>
          <Show when={!props.readOnly}>
            <Select
              class={styles.currency}
              listClass={styles.currencyList}
              label="Currency"
              title="Currency"
              align="end"
              value={currency()}
              options={CURRENCY_OPTIONS}
              onChange={(c) => s().setCurrency(props.id, c).catch(fail)}
            />
            <ColorTools
              color={s().color(props.id)}
              compact={props.rect.w <= COMPACT_TOOLS_MAX_W}
              label="Budget color"
              onPick={(c) => s().recolor(props.id, c).catch(fail)}
            />
          </Show>
        </div>
      </footer>
    </WidgetFrame>
  );
}
