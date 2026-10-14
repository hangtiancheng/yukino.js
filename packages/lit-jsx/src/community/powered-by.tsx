import { unsafeHTML } from "lit/directives/unsafe-html.js";
import litSvg from "../assets/lit.svg?raw";

export function PoweredByLit(): unknown {
  return (
    <div class="pointer-events-none fixed right-3 bottom-3 z-50">
      <div class="pointer-events-auto flex items-center gap-1.5 rounded-full border border-black/10 bg-white/85 px-2.5 py-1 text-[11px] leading-none text-black/60 shadow-sm backdrop-blur">
        {unsafeHTML(
          litSvg
            .replace(/width="[^"]*"/, 'width="13"')
            .replace(/height="[^"]*"/, 'height="16"'),
        )}
        <span>
          Powered by Lit + <span class="font-mono">@yukino.js/lit-jsx</span>
        </span>
      </div>
    </div>
  );
}
