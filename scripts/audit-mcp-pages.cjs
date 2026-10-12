const fs=require('node:fs'); const path=require('node:path'); const {app,BrowserWindow}=require('electron');
const profile=fs.mkdtempSync(path.resolve('work/mcp-app-audit-')); process.env.NEW_EDEN_SAGE_USER_DATA=profile;app.setPath('userData',profile);
BrowserWindow.prototype.show=function(){}; app.commandLine.appendSwitch('remote-debugging-port','0');
function seedSnapshotData(){
 const sourceProfile=process.env.SAGE_AUDIT_SOURCE_PROFILE;
 if(!sourceProfile)return;
 const settings=JSON.parse(fs.readFileSync(path.join(sourceProfile,'settings.json'),'utf8'));
 const localState=path.join(sourceProfile,'Local State');if(fs.existsSync(localState))fs.copyFileSync(localState,path.join(profile,'Local State'));
 const safeSettings={};
 for(const key of ['encryptedPrivateDataKey','dpapiPrivateDataKey','privateDataKeyVersion'])if(settings[key]!=null)safeSettings[key]=settings[key];
 fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify(safeSettings));
 fs.copyFileSync(path.join(process.env.SAGE_AUDIT_SEED_PROFILE,'new-eden-sage.sqlite'),path.join(profile,'new-eden-sage.sqlite'));
}
seedSnapshotData();require('../dist-electron/main.js');
const started=Date.now();
(async()=>{
 let window;
 while(Date.now()-started<30000){window=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed());if(window&&await window.webContents.executeJavaScript('!!document.documentElement.dataset.sagePages').catch(()=>false))break;await new Promise(r=>setTimeout(r,250));}
 if(!window||!await window.webContents.executeJavaScript('!!document.documentElement.dataset.sagePages'))throw Error('Sage frontend did not become ready');
 const endpoint=JSON.parse(fs.readFileSync(path.join(profile,'mcp-write-bridge.json'),'utf8'));
 const invoke=async(action,input={})=>{const r=await fetch('http://127.0.0.1:'+endpoint.port+'/action',{method:'POST',headers:{authorization:'Bearer '+endpoint.token,'content-type':'application/json'},body:JSON.stringify({action,input})});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
 const collectValues=async()=>{let offset=0,values=[];do{const batch=await invoke('get_sage_page_values',{offset,limit:1000});values.push(...batch.values);offset=batch.nextOffset;}while(offset!==null);return {total:values.length,values};};
 const pages=await invoke('list_sage_pages');const report={scope:process.env.SAGE_AUDIT_SOURCE_PROFILE?'Actual production frontend using read-only backup of saved account data; no live account credentials copied':'Actual production frontend in isolated profile with no connected characters; populated account states are not verified',pages:[]};
 for(const page of pages.pages){
  await invoke('navigate_sage_page',{pageId:page.id});await new Promise(r=>setTimeout(r,150));
  const values=await collectValues();const controls=await invoke('list_sage_controls',{limit:2000});
  const sections=await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('main [role="tab"],main [role="tablist"] button,main [class*="tabs"] button,main nav button')).filter(el=>!el.closest('[hidden]')&&el.getClientRects().length).map(el=>({id:el.getAttribute('data-sage-mcp-control-id'),label:el.innerText.trim()}))`);
  const row={...page,values:values.total,displayedValues:values.values,controls:controls.matching,discoveredControls:controls.controls,sections:[]};
  const visited=new Set();
  const sectionSelector='main [role="tab"],main [role="tablist"] button,main [class*="tabs"] button,main nav button';
  const discover=async()=>{await invoke('list_sage_controls',{limit:2000});return window.webContents.executeJavaScript(`Array.from(document.querySelectorAll(${JSON.stringify(sectionSelector)})).filter(el=>!el.closest('[hidden]')&&el.getClientRects().length&&!el.disabled).map(el=>({id:el.getAttribute('data-sage-mcp-control-id'),label:el.innerText.trim(),group:el.parentElement.className}))`);};
  const explore=async(depth,pathLabels=[])=>{
    if(depth>4)return;
    const candidates=await discover();
    for(const candidate of candidates){
      const key=candidate.group+'|'+candidate.label;
      if(visited.has(key)||!candidate.id)continue;
      const fresh=(await discover()).find(item=>item.group===candidate.group&&item.label===candidate.label);
      if(!fresh)continue;
      visited.add(key);
      try{
        await invoke('invoke_sage_control',{controlId:fresh.id,action:'click'});await new Promise(r=>setTimeout(r,140));
        const values=await collectValues();const path=[...pathLabels,candidate.label];
        row.sections.push({label:candidate.label,path,values:values.total,displayedValues:values.values});
        await explore(depth+1,path);
      }catch(error){row.sections.push({label:candidate.label,error:error.message});}
    }
  };
  await explore(0);
  report.pages.push(row);console.log(page.label+': '+row.values+' values, '+row.controls+' controls, '+row.sections.length+' sections');
 }
 const actions=await invoke('list_sage_actions');report.rendererActions=actions.actions.filter(a=>a.kind==='action').length;report.undocumentedActions=actions.actions.filter(a=>a.kind==='action'&&!a.parameters).map(a=>a.name);
 fs.writeFileSync('work/mcp-page-audit.json',JSON.stringify(report,null,2));console.log('PAGE AUDIT COMPLETE');
 app.quit();setTimeout(()=>app.exit(0),1000);
})().catch(e=>{console.error(e);app.exit(1)});
setTimeout(()=>{console.error('Audit timed out');app.exit(2)},160000).unref();
