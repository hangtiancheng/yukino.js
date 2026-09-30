import { unsafeStatic } from "lit/static-html.js";
import type { ElementRegistry } from "../types";

const tags =
  `a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript ol optgroup option output p picture pre progress q rp rt ruby s samp script section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr`.split(
    " ",
  );

const registry = Object.fromEntries(
  tags.map((tag) => [tag, unsafeStatic(tag)]),
) as ElementRegistry;
registry.default = unsafeStatic("div");

export default registry;
