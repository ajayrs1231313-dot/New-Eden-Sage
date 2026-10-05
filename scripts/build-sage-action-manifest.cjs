const fs=require('node:fs');
const source=fs.readFileSync('src/types.ts','utf8');
const block=source.slice(source.indexOf('    sage: {'));
const manifest={};
function splitTop(text,delimiter){let depth=0,quote='',escaped=false,start=0,parts=[];for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue;}if('"\'`'.includes(c)){quote=c;continue;}if('({[<'.includes(c))depth++;else if(')}]>'.includes(c) && !(c==='>' && text[i-1]==='='))depth--;if(c===delimiter&&depth===0){parts.push(text.slice(start,i).trim());start=i+1;}}parts.push(text.slice(start).trim());return parts.filter(Boolean);}
for(const match of block.matchAll(/^ {6}(\w+)\(/gm)){
 const start=match.index+match[0].length;let depth=1,i=start;while(i<block.length&&depth){if(block[i]==='(')depth++;if(block[i]===')')depth--;i++;}
 const parameters=splitTop(block.slice(start,i-1),',').map(p=>{const colon=p.indexOf(':');return {name:p.slice(0,colon).replace(/\?$/,''),optional:p.slice(0,colon).endsWith('?'),type:p.slice(colon+1).trim()};});
 let end=i;let braces=0;while(end<block.length){const c=block[end];if('({['.includes(c))braces++;else if(')}]'.includes(c))braces--;if(c===';'&&braces===0)break;end++;}
 manifest[match[1]]={parameters,returns:block.slice(i,end).replace(/^\s*:\s*/,'').trim()};
}
const preload=fs.readFileSync('electron/preload.ts','utf8');
for(const match of preload.matchAll(/^ {2}(\w+):\s*(?:async\s*)?\(/gm)){
 if(manifest[match[1]])continue;
 const start=match.index+match[0].length;let depth=1,i=start;while(i<preload.length&&depth){if(preload[i]==='(')depth++;if(preload[i]===')')depth--;i++;}
 const parameters=splitTop(preload.slice(start,i-1),',').map(p=>{const colon=p.indexOf(':');const equals=p.indexOf('=');const name=p.slice(0,colon>=0?colon:equals>=0?equals:p.length).trim();return {name:name.replace(/\?$/,''),optional:name.endsWith('?')||equals>=0,type:colon>=0?p.slice(colon+1).trim():undefined};});
 manifest[match[1]]={parameters,returns:'IPC result (not declared in renderer type interface)'};
}
fs.writeFileSync('electron/sage-action-manifest.ts','// Generated from src/types.ts by scripts/build-sage-action-manifest.cjs.\nexport const SAGE_ACTION_MANIFEST: Record<string, { parameters: Array<{ name: string; optional: boolean; type?: string }>; returns?: string }> = '+JSON.stringify(manifest,null,2)+';\n');
console.log('Documented '+Object.keys(manifest).length+' renderer action signatures');
