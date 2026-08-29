export type ResponsiveDisplayProfile = {
  width: number;
  height: number;
  zoom: number;
  label: string;
};

export const DISPLAY_FIT_DEFAULT_ENABLED = false;
export const DISPLAY_FIT_MIN_ZOOM = 0.72;

const widthZoom = (width: number) => {
  if (width >= 7000) return 1.5;
  if (width >= 5000) return 1.4;
  if (width >= 3800) return 1.3;
  if (width >= 2400) return 1.2;
  if (width >= 1900) return 1.08;
  if (width >= 1600) return 1.04;
  return 1;
};

const heightZoom = (height: number) => {
  if (height >= 4000) return 1.5;
  if (height >= 2800) return 1.4;
  if (height >= 2000) return 1.3;
  if (height >= 1400) return 1.2;
  if (height >= 1150) return 1.08;
  return 1;
};

/**
 * Scale only when both dimensions have enough room. This deliberately uses
 * BrowserWindow content size (device-independent pixels), so Windows display
 * scaling remains authoritative and Sage does not double-scale high-DPI users.
 */
export function responsiveDisplayZoom(width: number, height: number) {
  const safeWidth = Math.max(0, Number.isFinite(width) ? width : 0);
  const safeHeight = Math.max(0, Number.isFinite(height) ? height : 0);
  return Math.min(widthZoom(safeWidth), heightZoom(safeHeight));
}

/**
 * Keep Sage inside the current monitor/window without throwing away the larger
 * typography profiles. Fit mode only moves when there is real overflow (or
 * generous spare room after a previous shrink), and never shrinks below the
 * legibility floor. Long workspaces can therefore still scroll when scrolling
 * is genuinely necessary.
 */
export function fitDisplayZoom(
  baseZoom: number,
  currentZoom: number,
  viewportWidth: number,
  viewportHeight: number,
  contentWidth: number,
  contentHeight: number,
) {
  const safeBase = Math.max(DISPLAY_FIT_MIN_ZOOM, Number.isFinite(baseZoom) ? baseZoom : 1);
  const safeCurrent = Math.min(safeBase, Math.max(DISPLAY_FIT_MIN_ZOOM, Number.isFinite(currentZoom) ? currentZoom : safeBase));
  const safeViewportWidth = Math.max(1, Number.isFinite(viewportWidth) ? viewportWidth : 1);
  const safeViewportHeight = Math.max(1, Number.isFinite(viewportHeight) ? viewportHeight : 1);
  const safeContentWidth = Math.max(1, Number.isFinite(contentWidth) ? contentWidth : safeViewportWidth);
  const safeContentHeight = Math.max(1, Number.isFinite(contentHeight) ? contentHeight : safeViewportHeight);
  const fitRatio = Math.min(safeViewportWidth / safeContentWidth, safeViewportHeight / safeContentHeight);

  if (fitRatio < 1) {
    const fitted = safeCurrent * fitRatio * 0.99;
    return Math.round(Math.max(DISPLAY_FIT_MIN_ZOOM, Math.min(safeBase, fitted)) * 1000) / 1000;
  }

  // Hysteresis prevents a one-pixel scrollbar from making zoom bounce. Only
  // grow again when a view change leaves useful headroom.
  if (safeCurrent < safeBase - 0.001 && fitRatio > 1.04) {
    const grown = safeCurrent * fitRatio * 0.99;
    return Math.round(Math.max(DISPLAY_FIT_MIN_ZOOM, Math.min(safeBase, grown)) * 1000) / 1000;
  }

  return Math.round(safeCurrent * 1000) / 1000;
}

/** Representative monitor/window matrix used by the smoke test and as living documentation. */
export const RESPONSIVE_DISPLAY_PROFILES: ResponsiveDisplayProfile[] = [
  { width: 1024, height: 768, zoom: 1, label: "XGA 4:3" },
  { width: 1280, height: 720, zoom: 1, label: "HD 16:9" },
  { width: 1280, height: 1024, zoom: 1, label: "SXGA 5:4" },
  { width: 1366, height: 768, zoom: 1, label: "Laptop HD" },
  { width: 1600, height: 900, zoom: 1, label: "HD+" },
  { width: 1920, height: 1080, zoom: 1, label: "Full HD" },
  { width: 1920, height: 1200, zoom: 1.08, label: "WUXGA 16:10" },
  { width: 2560, height: 1080, zoom: 1, label: "Ultrawide 21:9" },
  { width: 2560, height: 1440, zoom: 1.2, label: "QHD" },
  { width: 3440, height: 1440, zoom: 1.2, label: "Ultrawide QHD" },
  { width: 3840, height: 1600, zoom: 1.2, label: "Ultrawide 4K-class" },
  { width: 3840, height: 2160, zoom: 1.3, label: "4K UHD" },
  { width: 5120, height: 1440, zoom: 1.2, label: "Super ultrawide DQHD" },
  { width: 5120, height: 2160, zoom: 1.3, label: "5K2K ultrawide" },
  { width: 5120, height: 2880, zoom: 1.4, label: "5K" },
  { width: 7680, height: 4320, zoom: 1.5, label: "8K UHD" },
];
