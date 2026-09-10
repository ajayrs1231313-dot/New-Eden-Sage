import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const READABLE_FONT_FLOOR_PX = 12;
const READABLE_FONT_FLOOR_REM = READABLE_FONT_FLOOR_PX / 16;

function floorFontShorthand(value: string) {
  return value.replace(/(\d*\.?\d+)(px|rem)(?=\/|\s|$)/i, (token, rawNumber, unit) => {
    const numeric = Number(rawNumber);
    if (unit.toLowerCase() === "px" && numeric < READABLE_FONT_FLOOR_PX) return `${READABLE_FONT_FLOOR_PX}px`;
    if (unit.toLowerCase() === "rem" && numeric < READABLE_FONT_FLOOR_REM) return `${READABLE_FONT_FLOOR_REM}rem`;
    return token;
  });
}

function enforceReadableFontSizes(css: string) {
  const withFontSizeFloor = css.replace(/font-size\s*:\s*([^;{}]+)/gi, (declaration: string, rawValue: string) => {
    const value = rawValue.trim();

    const clampMatch = value.match(
      /^clamp\(\s*(\d*\.?\d+)px\s*,([\s\S]*),\s*(\d*\.?\d+)px\s*\)(\s*!important)?$/i,
    );
    if (clampMatch) {
      const minimum = Math.max(READABLE_FONT_FLOOR_PX, Number(clampMatch[1]));
      const maximum = Math.max(minimum, Number(clampMatch[3]));
      return `font-size: clamp(${minimum}px,${clampMatch[2]},${maximum}px)${clampMatch[4] ?? ""}`;
    }

    const pxMatch = value.match(/^(\d*\.?\d+)px(\s*!important)?$/i);
    if (pxMatch && Number(pxMatch[1]) < READABLE_FONT_FLOOR_PX) {
      return `font-size: ${READABLE_FONT_FLOOR_PX}px${pxMatch[2] ?? ""}`;
    }

    const remMatch = value.match(/^(\d*\.?\d+)rem(\s*!important)?$/i);
    if (remMatch && Number(remMatch[1]) < READABLE_FONT_FLOOR_REM) {
      return `font-size: ${READABLE_FONT_FLOOR_REM}rem${remMatch[2] ?? ""}`;
    }

    return declaration;
  });

  return withFontSizeFloor.replace(/\bfont\s*:\s*([^;{}]+)/gi, (declaration: string, rawValue: string) => {
    const value = rawValue.trim();
    const transformed = floorFontShorthand(value);
    return transformed === value ? declaration : `font: ${transformed}`;
  });
}

function readableFontFloor(): Plugin {
  return {
    name: "sage-readable-font-floor",
    enforce: "pre",
    transform(code, id) {
      const cleanId = id.split("?")[0].replaceAll("\\", "/");
      if (!cleanId.includes("/src/") || !cleanId.endsWith(".css")) return null;
      const transformed = enforceReadableFontSizes(code);
      return transformed === code ? null : { code: transformed, map: null };
    },
  };
}

export default defineConfig({
  plugins: [readableFontFloor(), react()],
  base: "./",
});
