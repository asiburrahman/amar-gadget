import { sendGAEvent } from "./ga";

export function reportWebVitals(metric: {
  id: string;
  name: string;
  label: string;
  value: number;
}) {
  sendGAEvent({
    action: "web_vitals",
    category: "Web Vitals",
    label: metric.name,
    value: Math.round(metric.name === "CLS" ? metric.value * 1000 : metric.value),
    nonInteraction: true,
  });
}