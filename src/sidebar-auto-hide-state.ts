export const SIDEBAR_AUTO_HIDE_ONBOARDING_STORAGE_KEY = "new-eden-sage:navigation:auto-hide-onboarding-seen:v1";
export const SIDEBAR_PINNED_STORAGE_KEY = "new-eden-sage:navigation:pinned:v1";
export const SIDEBAR_HIDE_DELAY_MS = 400;

export type SidebarAutoHideState = {
  onboardingSeen: boolean;
  pinned: boolean;
  open: boolean;
};

export type SidebarAutoHideAction =
  | { type: "edge-open" }
  | { type: "confirm-onboarding" }
  | { type: "pin" }
  | { type: "unpin" }
  | { type: "hide" }
  | { type: "navigation-selected" }
  | { type: "escape" };

export function createSidebarAutoHideState(onboardingSeen: boolean, pinned: boolean): SidebarAutoHideState {
  return {
    onboardingSeen,
    pinned: onboardingSeen ? pinned : false,
    open: !onboardingSeen || pinned,
  };
}

export function transitionSidebarAutoHide(
  state: SidebarAutoHideState,
  action: SidebarAutoHideAction,
): SidebarAutoHideState {
  switch (action.type) {
    case "edge-open":
      return state.open ? state : { ...state, open: true };
    case "confirm-onboarding":
      return { onboardingSeen: true, pinned: false, open: false };
    case "pin":
      return { ...state, pinned: true, open: true };
    case "unpin":
      return { ...state, pinned: false, open: false };
    case "hide":
    case "navigation-selected":
    case "escape":
      if (!state.onboardingSeen || state.pinned || !state.open) return state;
      return { ...state, open: false };
  }
}

export type SidebarHideScheduler = {
  schedule(): void;
  cancel(): void;
  dispose(): void;
};

export function createSidebarHideScheduler(onHide: () => void, delayMs = SIDEBAR_HIDE_DELAY_MS): SidebarHideScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    schedule() {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        onHide();
      }, delayMs);
    },
    cancel,
    dispose: cancel,
  };
}
