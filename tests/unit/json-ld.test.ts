import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { serializeJsonLd } from "../../lib/seo/serialize-json-ld";

describe("HTML-safe product structured data", () => {
  it("prevents a product field from terminating the script element", () => {
    const payload = { name: '</script><script>globalThis.injected=true</script>', description: '<img src=x onerror="alert(1)">' };
    const serialized = serializeJsonLd(payload);
    const html = renderToStaticMarkup(createElement("script", {
      type: "application/ld+json",
      dangerouslySetInnerHTML: { __html: serialized },
    }));

    expect(JSON.parse(serialized)).toEqual(payload);
    expect(serialized).not.toContain("<");
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain("<img");
  });
});
