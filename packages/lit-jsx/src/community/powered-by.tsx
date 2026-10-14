import { unsafeHTML } from "lit/directives/unsafe-html.js";
import litSvg from "../assets/lit.svg?raw";

const MONO_FONT =
  'Yukino, "Maple Mono", "SF Mono", Menlo, Monaco, "Cascadia Code", "Liberation Mono", "DejaVu Sans Mono", monospace';

/**
 * Floating "Powered by Lit + @yukino.js/lit-jsx" badge.
 *
 * Styled entirely through lit-jsx's `style` prop (Lit `styleMap`) — no
 * Tailwind or any other CSS framework required. The semantic
 * `powered-by-lit` / `powered-by-lit-badge` class names are stable hooks for
 * consumer overrides (inline styles win, so use `!important` if needed).
 */
export function PoweredByLit(): unknown {
  return (
    <div
      class="powered-by-lit"
      style={{
        position: "fixed",
        bottom: "12px",
        right: "12px",
        zIndex: "50",
        pointerEvents: "none",
      }}
    >
      <div
        class="powered-by-lit-badge"
        style={{
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          borderRadius: "9999px",
          border: "1px solid rgba(0, 0, 0, 0.1)",
          backgroundColor: "rgba(255, 255, 255, 0.85)",
          padding: "4px 10px",
          fontSize: "11px",
          lineHeight: "1",
          color: "rgba(0, 0, 0, 0.6)",
          boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
          backdropFilter: "blur(8px)",
          "-webkit-backdrop-filter": "blur(8px)",
        }}
      >
        {unsafeHTML(
          litSvg
            .replace(/width="[^"]*"/, 'width="13"')
            .replace(/height="[^"]*"/, 'height="16"'),
        )}
        <span>
          Powered by Lit +{" "}
          <span style={{ fontFamily: MONO_FONT }}>@yukino.js/lit-jsx</span>
        </span>
      </div>
    </div>
  );
}
