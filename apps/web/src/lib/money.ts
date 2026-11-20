import type { Currency } from "@bentogether/shared";

/*
 * Budget amounts are whole hundredths of the major unit for every currency
 * (see CURRENCIES in protocol.ts). These helpers turn them into text and
 * back, in the viewer's own number format.
 */

const digitsCache = new Map<Currency, number>();

/** Decimal places a currency shows: 2 for USD, 0 for JPY and KRW. */
export function currencyDigits(currency: Currency): number {
  let d = digitsCache.get(currency);
  if (d === undefined) {
    d =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ??
      2;
    digitsCache.set(currency, d);
  }
  return d;
}

/**
 * "$1,250" or "$12.50": decimals only when there are any, so round budgets
 * stay short. `signed` adds "+" or "−" for changes in the log.
 */
export function formatMoney(hundredths: number, currency: Currency, opts: { signed?: boolean } = {}): string {
  const digits = currencyDigits(currency);
  const whole = hundredths % 100 === 0 || digits === 0;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: whole ? 0 : digits,
    signDisplay: opts.signed ? "exceptZero" : "auto",
  })
    .format(hundredths / 100)
    .replace("-", "−");
}

/** The plain number to edit: "1250" or "12.50", no symbol or grouping. */
export function editableAmount(hundredths: number, currency: Currency): string {
  const digits = currencyDigits(currency);
  const whole = hundredths % 100 === 0 || digits === 0;
  return (hundredths / 100).toFixed(whole ? 0 : digits);
}

/**
 * Reads what someone typed: "20", "-20", "+1,250.50", "1.250,50", "$12.5".
 * Returns hundredths and any sign they typed, or null if it isn't a number.
 * A separator followed by one or two digits is the decimal point; followed
 * by three it's grouping.
 */
export function parseAmount(
  text: string,
  currency: Currency,
): { hundredths: number; sign: "+" | "-" | null } | null {
  const t = text.trim().replace(/[−‒–]/g, "-");
  const sign = t.startsWith("-") || t.endsWith("-") ? "-" : t.startsWith("+") ? "+" : null;
  const raw = t.replace(/[^\d.,]/g, "");
  if (!/\d/.test(raw)) return null;
  const last = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
  let number: number;
  const tail = last === -1 ? "" : raw.slice(last + 1);
  if (last !== -1 && tail.length > 0 && tail.length <= 2 && currencyDigits(currency) > 0) {
    number = Number(`${raw.slice(0, last).replace(/[.,]/g, "")}.${tail}`);
  } else {
    number = Number(raw.replace(/[.,]/g, ""));
  }
  if (!Number.isFinite(number)) return null;
  const digits = currencyDigits(currency);
  // Currencies without decimals round to whole units.
  const hundredths = digits === 0 ? Math.round(number) * 100 : Math.round(number * 100);
  return { hundredths, sign };
}
