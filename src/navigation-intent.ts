export const OPEN_NAVIGATION_ROUTE_EVENT = "sage:open-navigation-route";
export const OPEN_NAVIGATION_ROUTE_PENDING_KEY = "new-eden-sage-open-navigation-route";

export interface NavigationRouteIntent {
  originSystemId: number;
  originSystemName: string;
  destinationSystemId: number;
  destinationSystemName: string;
  destinationLocationId?: number;
  destinationLocationName?: string;
}

export function queueNavigationRouteIntent(intent: NavigationRouteIntent) {
  sessionStorage.setItem(OPEN_NAVIGATION_ROUTE_PENDING_KEY, JSON.stringify(intent));
  window.dispatchEvent(new CustomEvent(OPEN_NAVIGATION_ROUTE_EVENT, { detail: intent }));
}

export function consumeNavigationRouteIntent(): NavigationRouteIntent | null {
  const raw = sessionStorage.getItem(OPEN_NAVIGATION_ROUTE_PENDING_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(OPEN_NAVIGATION_ROUTE_PENDING_KEY);
  try {
    const parsed = JSON.parse(raw) as Partial<NavigationRouteIntent>;
    const originSystemId = Number(parsed.originSystemId);
    const destinationSystemId = Number(parsed.destinationSystemId);
    if (!Number.isSafeInteger(originSystemId) || originSystemId <= 0 || !Number.isSafeInteger(destinationSystemId) || destinationSystemId <= 0) return null;
    return {
      originSystemId,
      originSystemName: String(parsed.originSystemName ?? `System ${originSystemId}`),
      destinationSystemId,
      destinationSystemName: String(parsed.destinationSystemName ?? `System ${destinationSystemId}`),
      destinationLocationId: Number(parsed.destinationLocationId) > 0 ? Number(parsed.destinationLocationId) : undefined,
      destinationLocationName: parsed.destinationLocationName ? String(parsed.destinationLocationName) : undefined,
    };
  } catch {
    return null;
  }
}
