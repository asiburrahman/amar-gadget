import { H1, H2, H3, H4, P, Code, Muted } from "../../components/ui/typography";

describe("Typography Component Suite", () => {
  it("renders H1 element with proper styling classes and custom class overrides", () => {
    const component = H1({ children: "Amar Gadget Title", className: "custom-heading" });
    expect(component.type).toBe("h1");
    expect(component.props.className).toContain("font-bold");
    expect(component.props.className).toContain("font-sans");
    expect(component.props.className).toContain("custom-heading");
  });

  it("renders H2, H3, and H4 heading elements with semantic tag structures and IDs", () => {
    const h2 = H2({ children: "Subheading H2", id: "heading-2" });
    expect(h2.type).toBe("h2");
    expect(h2.props.id).toBe("heading-2");
    expect(h2.props.className).toContain("text-3xl");

    const h3 = H3({ children: "Subheading H3" });
    expect(h3.type).toBe("h3");
    expect(h3.props.className).toContain("text-2xl");

    const h4 = H4({ children: "Subheading H4" });
    expect(h4.type).toBe("h4");
    expect(h4.props.className).toContain("text-xl");
  });

  it("renders body paragraph P element with font-inter spacing", () => {
    const p = P({ children: "Paragraph body text" });
    expect(p.type).toBe("p");
    expect(p.props.className).toContain("font-inter");
    expect(p.props.className).toContain("leading-relaxed");
  });

  it("renders monospace Code element with custom tokens and HTML attribute pass-through", () => {
    const code = Code({ children: "ORDER-12345", "aria-label": "Order Code" });
    expect(code.type).toBe("code");
    expect(code.props.className).toContain("font-mono");
    expect(code.props.className).toContain("text-sm");
    expect(code.props["aria-label"]).toBe("Order Code");
  });

  it("renders Muted text element with text-muted-foreground class", () => {
    const muted = Muted({ children: "Muted note" });
    expect(muted.type).toBe("span");
    expect(muted.props.className).toContain("text-muted-foreground");
    expect(muted.props.className).toContain("font-inter");
  });
});
