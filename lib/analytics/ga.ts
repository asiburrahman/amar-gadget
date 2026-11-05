type GAEventParams = {
  action: string;
  category?: string;
  label?: string;
  value?: number;
  [key: string]: unknown;
};

export function sendGAEvent({ action, ...params }: GAEventParams) {
  const layer = typeof window === "undefined" ? undefined : (window as Window & { dataLayer?: unknown }).dataLayer;
  if (Array.isArray(layer)) {
    layer.push({
      event: action,
      ...params,
    });
  }
}
