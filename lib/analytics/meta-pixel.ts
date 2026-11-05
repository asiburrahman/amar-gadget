export function trackMetaEvent(eventName: string, data?: Record<string, unknown>) {
  const pixel = typeof window === "undefined" ? undefined : (window as Window & { fbq?: (command: "track", name: string, data?: Record<string, unknown>) => void }).fbq;
  if (typeof pixel === "function") {
    pixel("track", eventName, data);
  }
}
