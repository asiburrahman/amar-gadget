export function trackMetaEvent(eventName: string, data?: Record<string, any>) {
  if (typeof window !== "undefined" && (window as any).fbq) {
    (window as any).fbq("track", eventName, data);
  }
}