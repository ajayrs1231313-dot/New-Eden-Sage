import type { SVGProps } from "react";

export type IskGlyphName =
  | "cart"
  | "bars"
  | "route"
  | "pulse"
  | "cubes"
  | "search"
  | "shield"
  | "bolt"
  | "percent"
  | "coin"
  | "box"
  | "reset"
  | "download"
  | "orders"
  | "contract"
  | "target"
  | "invention"
  | "planet"
  | "pve"
  | "chevron";

export function IskGlyph({ name, ...props }: { name: IskGlyphName } & SVGProps<SVGSVGElement>) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...props,
    className: props.className ? `isk-glyph ${props.className}` : "isk-glyph",
  };

  switch (name) {
    case "cart":
      return <svg {...common}><path d="M3 5h2l1.7 9.1a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 1.9-1.5L20 8H6"/><circle cx="9" cy="19" r="1.2"/><circle cx="17" cy="19" r="1.2"/></svg>;
    case "bars":
      return <svg {...common}><path d="M5 20V11M10 20V6M15 20V9M20 20V3"/></svg>;
    case "route":
      return <svg {...common}><circle cx="6" cy="17" r="2.5"/><circle cx="17.5" cy="6.5" r="2.5"/><path d="M8.5 17h3.4a3 3 0 0 0 3-3v-2.2M15.7 8.2l-1.8 2.2M4.5 8.5h4M3 11h7"/></svg>;
    case "pulse":
      return <svg {...common}><path d="M2 13h4l2-6 3.5 11 3-9 2 4H22"/></svg>;
    case "cubes":
      return <svg {...common}><path d="m12 3 4 2.3v4.5L12 12l-4-2.2V5.3L12 3Z"/><path d="m7 12.5 4 2.3v4.5L7 21l-4-2.2v-4.5l4-1.8ZM17 12.5l4 1.8v4.5L17 21l-4-1.7v-4.5l4-2.3Z"/></svg>;
    case "search":
      return <svg {...common}><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/></svg>;
    case "shield":
      return <svg {...common}><path d="M12 3 5.5 5.5v5.3c0 4.2 2.7 7.7 6.5 9.2 3.8-1.5 6.5-5 6.5-9.2V5.5L12 3Z"/><path d="m9 12 2 2 4-4"/></svg>;
    case "bolt":
      return <svg {...common}><path d="m13 2-7 11h6l-1 9 7-12h-6l1-8Z"/></svg>;
    case "percent":
      return <svg {...common}><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/><path d="m18 5-12 14"/></svg>;
    case "coin":
      return <svg {...common}><ellipse cx="12" cy="6" rx="6.5" ry="3"/><path d="M5.5 6v5c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3V6M5.5 11v5c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3v-5"/></svg>;
    case "box":
      return <svg {...common}><path d="m12 3 8 4-8 4-8-4 8-4Z"/><path d="M4 7v9l8 5 8-5V7M12 11v10"/></svg>;
    case "reset":
      return <svg {...common}><path d="M5 7V3l-3 3 3 3V7a8 8 0 1 1-1 10"/></svg>;
    case "download":
      return <svg {...common}><path d="M12 3v12m-4-4 4 4 4-4M4 20h16"/></svg>;
    case "orders":
      return <svg {...common}><path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4"/></svg>;
    case "contract":
      return <svg {...common}><path d="M7 3h7l4 4v14H7zM14 3v5h4M10 12h5M10 16h5"/></svg>;
    case "target":
      return <svg {...common}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>;
    case "invention":
      return <svg {...common}><path d="M9 3h6M10 3v5l-5 9a2.5 2.5 0 0 0 2.2 4h9.6a2.5 2.5 0 0 0 2.2-4l-5-9V3M8 15h8"/></svg>;
    case "planet":
      return <svg {...common}><circle cx="12" cy="12" r="5"/><path d="M3 15.5c3-4 8.2-6.4 13.7-6.4 2.3 0 4 .5 4.3 1.4.5 1.6-3.1 4.2-8.1 5.7S3.5 17 3 15.5Z"/></svg>;
    case "pve":
      return <svg {...common}><path d="m12 3 2.2 4.5 5 .7-3.6 3.5.8 5-4.4-2.3-4.4 2.3.8-5-3.6-3.5 5-.7L12 3Z"/></svg>;
    case "chevron":
      return <svg {...common}><path d="m9 6 6 6-6 6"/></svg>;
  }
}
