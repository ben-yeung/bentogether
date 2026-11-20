import type { PointerVariant } from "./Pointer";

/**
 * Your own pointer as a real CSS cursor: an SVG of the same glyph, filled
 * with your color. The OS draws CSS cursors in hardware, so this has zero
 * lag, unlike a DOM element chasing `pointermove` (always a frame or more
 * behind). Only the name pill next to it is a DOM element.
 */

/** oklch → sRGB hex. CSS cursor images can't resolve CSS variables or oklch. */
export function oklchToHex(l: number, c: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return (
    "#" +
    rgb
      .map((v) => {
        const g = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
        return Math.round(Math.min(1, Math.max(0, g)) * 255)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}

type Glyph = { viewBox: [number, number]; d: string; filled: boolean; hot: [number, number] };

// Same paths as Pointer.tsx, with hotspots in viewBox units.
const GLYPHS: Record<PointerVariant, Glyph> = {
  dart: { viewBox: [20, 20], d: "M1.5 1.5 18.5 7.6 10.6 10.6 7.6 18.5Z", filled: true, hot: [1.5, 1.5] },
  hand: {
    viewBox: [18, 22],
    d: "M6.3 1.2c1.2 0 2.1.9 2.1 2.1v6.1l5.5 1.1c1.5.3 2.5 1.6 2.4 3.1l-.3 4.3c-.2 1.9-1.7 3.3-3.6 3.3H8.9c-1.1 0-2.2-.5-2.9-1.4l-4.5-5.7c-.7-.9-.1-2.2 1-2.3.6 0 1.2.2 1.6.7V3.3c0-1.2.9-2.1 2.2-2.1Z",
    filled: true,
    hot: [6.3, 1.4],
  },
  grab: {
    viewBox: [22, 20],
    d: "M4.2 7.4c0-1.1.9-1.9 2-1.9s2 .8 2 1.9V6.3c0-1.1.9-1.9 2-1.9s2 .8 2 1.9v.6c0-1 .9-1.8 2-1.8s1.9.8 1.9 1.8v1.3c0-.9.8-1.6 1.8-1.6s1.8.7 1.8 1.6v5.2c0 3.6-2.9 6.3-6.5 6.3h-1.6c-2.2 0-4.2-1-5.5-2.8L2.6 12.5c-.6-.9-.4-2 .4-2.5.6-.4 1.4-.3 1.9.2l-.7-2.8Z",
    filled: true,
    hot: [11, 10],
  },
  ibeam: {
    viewBox: [20, 20],
    d: "M6.5 2.5c2 0 3.5.8 3.5 2.2v10.6c0 1.4-1.5 2.2-3.5 2.2M13.5 2.5c-2 0-3.5.8-3.5 2.2v10.6c0 1.4 1.5 2.2 3.5 2.2",
    filled: false,
    hot: [10, 10],
  },
};

const INK = "#1d1916";
const cache = new Map<string, string>();

/** A `cursor` value for the glyph in this color, sized in CSS px. */
export function cursorCss(variant: PointerVariant, color: string, sizePx: number): string {
  const key = `${variant}|${color}|${sizePx}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const g = GLYPHS[variant];
  const [vw, vh] = g.viewBox;
  const scale = sizePx / Math.max(vw, vh);
  const w = Math.ceil(vw * scale) + 4;
  const h = Math.ceil(vh * scale) + 4;
  // An ink outline under the fill keeps the color legible on any note.
  const paint = g.filled
    ? `<path d="${g.d}" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round" opacity=".55"/><path d="${g.d}" fill="${color}" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`
    : `<path d="${g.d}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" opacity=".55"/><path d="${g.d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="-2 -2 ${vw + 4 / scale} ${vh + 4 / scale}">${paint}</svg>`;
  const hx = Math.round((g.hot[0] + 2) * scale);
  const hy = Math.round((g.hot[1] + 2) * scale);
  const fallback = variant === "ibeam" ? "text" : variant === "dart" ? "default" : "pointer";
  const css = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, ${fallback}`;
  cache.set(key, css);
  return css;
}
