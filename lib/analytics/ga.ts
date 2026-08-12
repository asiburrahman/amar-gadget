type GAEventParams = {
  action: string;
  category?: string;
  label?: string;
  value?: number;
  [key: string]: any;
};

export function sendGAEvent({ action, ...params }: GAEventParams) {
  if (typeof window !== "undefined" && (window as any).dataLayer) {
    (window as any).dataLayer.push({
      event: action,
      ...params,
    });
  }
}