const fs=require('fs');
const p='electron/eve-assets.ts';let s=fs.readFileSync(p,'utf8');
function replaceOnce(from,to,label){if(!s.includes(from))throw new Error('Missing '+label);s=s.replace(from,to);}
if(!s.includes('DATA_ROOT, STATIC_DATA_ROOT')) replaceOnce('import { STATIC_DATA_ROOT } from "./data-paths";','import { DATA_ROOT, STATIC_DATA_ROOT } from "./data-paths";','data path import');
if(!s.includes('FITTER_CONTENT_ASSET_ROOT')) replaceOnce('const TYPE_IMAGE_ROOT = path.join(STATIC_DATA_ROOT, "Type Images");','const TYPE_IMAGE_ROOT = path.join(STATIC_DATA_ROOT, "Type Images");\r\nconst FITTER_CONTENT_ASSET_ROOT = path.join(DATA_ROOT, "Fitter Content");','asset root');
if(!s.includes('fitterContentProtocolResponse')){
 const marker='export async function typeImageProtocolResponse(requestUrl: string) {';
 const idx=s.indexOf(marker);if(idx<0)throw new Error('Missing protocol response');
 const helper=`async function fitterContentProtocolResponse(url: URL) {\r\n  const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);\r\n  if (!parts.length) throw new Error("Missing fitter content asset path.");\r\n  const root = path.resolve(FITTER_CONTENT_ASSET_ROOT);\r\n  const target = path.resolve(root, ...parts);\r\n  const rootPrefix = root.toLowerCase() + path.sep;\r\n  if (!target.toLowerCase().startsWith(rootPrefix)) throw new Error("Invalid fitter content asset path.");\r\n  const ext = path.extname(target).toLowerCase();\r\n  const allowed = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);\r\n  if (!allowed.has(ext)) throw new Error("Unsupported fitter content asset type.");\r\n  const data = await fs.readFile(target);\r\n  const contentType = ext === ".svg" ? "image/svg+xml" : ext === ".gif" ? "image/gif" : imageContentType(data);\r\n  return new Response(data, { status:200, headers:{ "Content-Type":contentType, "Cache-Control":"no-cache" } });\r\n}\r\n\r\n`;
 s=s.slice(0,idx)+helper+s.slice(idx);
 replaceOnce('    const url = new URL(requestUrl);\r\n    const parts = url.pathname.split("/").filter(Boolean);','    const url = new URL(requestUrl);\r\n    if (url.hostname === "fitter-content") return await fitterContentProtocolResponse(url);\r\n    const parts = url.pathname.split("/").filter(Boolean);','protocol dispatch');
}
fs.writeFileSync(p,s);

const fp='src/fitter-presentation.ts';let f=fs.readFileSync(fp,'utf8');
const old=`export function resolveFitterArtwork(artwork:string) {\n  if (/^(?:https?:|data:|blob:|file:|sage-asset:)/i.test(artwork)) return artwork;\n  return assetModules[artwork] ?? assetModules[artwork.replace(/^\\.\\//,"./")] ?? artwork;\n}`;
const next=`export function resolveFitterArtwork(artwork:string) {\n  if (/^(?:https?:|data:|blob:|file:|sage-asset:)/i.test(artwork)) return artwork;\n  const bundled = assetModules[artwork] ?? assetModules[artwork.replace(/^\\.\\//,"./")];\n  if (bundled) return bundled;\n  const relative = artwork.replace(/\\\\/g,"/").replace(/^\\.\\//,"").split("/").filter(Boolean).map(encodeURIComponent).join("/");\n  return relative ? \`sage-asset://fitter-content/${relative}\` : artwork;\n}`;
if(!f.includes('sage-asset://fitter-content/')){if(!f.includes(old))throw new Error('Missing resolveFitterArtwork');f=f.replace(old,next);fs.writeFileSync(fp,f);}
console.log('fitter content assets now resolve through safe local protocol');
