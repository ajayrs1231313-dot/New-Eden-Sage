export type ResponsiveDisplayProfile = {
  width: number;
  height: number;
  zoom: number;
  label: string;
};

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
