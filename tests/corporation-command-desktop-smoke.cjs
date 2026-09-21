const path=require("node:path");
const {app,BrowserWindow,ipcMain}=require("electron");
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const js=(win,code)=>win.webContents.executeJavaScript(code);

const discordWriteChannels=["corp:discord-configure","corp:discord-announce","corp:discord-notification-targets","corp:discord-test-dm","corp:discord-unlink","corp:ops-announce-discord"];
const discordWriteAttempts=[];
for(const channel of discordWriteChannels)ipcMain.handle(channel,(_e,input)=>{discordWriteAttempts.push({channel,input});throw new Error("DISCORD WRITE FORBIDDEN IN SMOKE TEST");});

const staleAj={
 characterId:"569399317",updatedAt:"2026-09-15T19:26:08.924Z",snapshotState:"synced",
 character:{name:"Ajdeathgiver",corporation_id:98840908,corporation_name:"Graybeard Cartel"},
 location:{solar_system_id:30000106,solar_system_name:"Shedoo"},
 extended:{corporation:{
  publicData:{name:"Graybeard Cartel",ticker:"GRYN",member_count:41,tax_rates:{isk:3,loyalty_point:1},war_eligible:true,date_founded:"2026-08-08T01:31:19Z"},
  structures:[{fuel_expires:"2026-09-18T23:00:00Z",name:"Shedoo - Diabolical",reinforce_hour:18,services:[{name:"Reprocessing",state:"online"},{name:"Manufacturing (Standard)",state:"online"},{name:"Moon Drilling",state:"online"}],state:"shield_vulnerable",structure_id:1055448546656,system_id:30000106,type_id:35835}],
  facilities:[{facility_id:1055448546656,system_id:30000106,type_id:35835}],
  starbases:{unavailable:true,error:"ESI request failed (403) for /corporations/98840908/starbases/?page=1."},
  assets:{unavailable:true,error:"ESI request failed (403) for /corporations/98840908/assets/?page=1."},
  blueprints:{unavailable:true,error:"ESI request failed (403) for /corporations/98840908/blueprints/?page=1."},
  industryJobs:[],marketOrders:[],contracts:[{contract_id:1},{contract_id:2}],wallets:Array.from({length:7},(_,i)=>({division:i+1,balance:0})),
  members:Array.from({length:41},(_,i)=>2000000000+i),
  memberTracking:{unavailable:true,error:"ESI request failed (401) for /corporations/98840908/membertracking/."},
  memberTitles:{unavailable:true,error:"ESI request failed (403)"},titles:{unavailable:true,error:"ESI request failed (403)"},
  roles:{roles:["Accountant"]}
 }}
};
const freshNed={
 characterId:"769483498",updatedAt:"2026-09-21T04:48:52.131Z",snapshotState:"synced",
 character:{name:"Nedoode",corporation_id:98840908,corporation_name:"Graybeard Cartel"},
 location:{solar_system_id:30000106,solar_system_name:"Shedoo"},
 extended:{corporation:{
  publicData:{name:"Graybeard Cartel",ticker:"GRYN",member_count:45,tax_rates:{isk:3,loyalty_point:1},war_eligible:true,date_founded:"2026-08-08T01:31:19Z",shares:1000},
  structures:[
   {fuel_expires:"2026-10-28T19:00:00Z",name:"Shedoo - Diabolical",reinforce_hour:18,services:[{name:"Reprocessing",state:"online"},{name:"Manufacturing (Standard)",state:"online"},{name:"Moon Drilling",state:"online"}],state:"shield_vulnerable",structure_id:1055448546656,system_id:30000106,type_id:35835},
   {fuel_expires:"2026-11-28T12:00:00Z",name:"Shedoo - Femboi Palace",reinforce_hour:23,services:[{name:"Material Efficiency Research",state:"online"},{name:"Blueprint Copying",state:"online"},{name:"Time Efficiency Research",state:"online"}],state:"shield_vulnerable",structure_id:1055697124112,system_id:30000106,type_id:35825}
  ],
  facilities:[{facility_id:1055697124112,system_id:30000106,type_id:35825},{facility_id:1055448546656,system_id:30000106,type_id:35835}],
  starbases:[],assets:Array.from({length:346},(_,i)=>({item_id:i+1,type_id:34,quantity:1})),blueprints:Array.from({length:57},(_,i)=>({item_id:i+1,type_id:681})),
  industryJobs:Array.from({length:3},(_,i)=>({job_id:i+1,status:"active"})),marketOrders:[],contracts:Array.from({length:4},(_,i)=>({contract_id:i+1})),
  wallets:Array.from({length:7},(_,i)=>({division:i+1,balance:1000000})),members:["569399317","769483498",...Array.from({length:49},(_,i)=>2100000000+i)],
  memberTracking:[{character_id:569399317,ship_type_id:670,location_id:30000106,logon_date:"2026-09-21T04:00:00Z",logoff_date:"2026-09-21T03:00:00Z",start_date:"2026-08-10T00:00:00Z"},{character_id:769483498,ship_type_id:670,location_id:30000106,logon_date:"2026-09-21T04:00:00Z",logoff_date:"2026-09-21T03:00:00Z",start_date:"2026-08-10T00:00:00Z"},...Array.from({length:49},(_,i)=>({character_id:2100000000+i,ship_type_id:670,location_id:30000106,logon_date:"2026-09-21T04:00:00Z",logoff_date:"2026-09-21T03:00:00Z",start_date:"2026-08-10T00:00:00Z"}))],
  memberTitles:[{character_id:569399317,titles:[]},{character_id:769483498,titles:[]},...Array.from({length:49},(_,i)=>({character_id:2100000000+i,titles:[]}))],titles:Array.from({length:16},(_,i)=>({title_id:i+1,name:"Title "+(i+1)})),roles:{roles:["Director"]}
 }}
};
const snapshots=[staleAj,freshNed];
let exposeCorpSnapshots=false;
ipcMain.handle("snapshot:list",()=>exposeCorpSnapshots?snapshots:[]);

const handlers=[
 ["config:get",{}],["display-fit:set",{enabled:false}],["display-fit:refresh",{enabled:false}],
 ["metrics:submit",true],["update:get-state",{available:false,checking:false}],["system-time:get",{now:new Date().toISOString()}],["public-data:status",{connected:true}],
 ["system-intelligence:search",[]],["system-intelligence:refresh-watched",{systems:[],killmailRefresh:{}}],
 ["corp:find-home",{generatedAt:new Date().toISOString(),candidateCount:0,candidates:[],filters:{},iceReference:{source:"fixture",reviewedAt:new Date().toISOString(),systemCount:0}}],
 ["corp:find-home-scan",{}],["market:search-ore-types",[]],["universe:ships",[]],
 ["corp:ops-workspace",{workspace_id:"smoke-workspace",corporation_id:98840908,corporation_name:"Graybeard Cartel",character_id:769483498,character_name:"Nedoode",can_manage_fleet_ops:false,can_approve_fleet_ops:false,can_configure_permissions:false,roles:[],titles:[],member_access:"active"}],
 ["corp:ops-list",[]],
 ["corp:roles-state",{workspace:{workspace_id:"smoke-workspace"},policy:{can_configure:false,is_corporation_ceo:false,is_director:false,administrators:[{key:"ceo",label:"CEO",locked:true},{key:"director",label:"Director",locked:true}],available_roles:[{key:"Accountant",label:"Accountant"}],available_titles:[{value:"Industry",label:"Industry"}],permissions:[{key:"fleet.manage",label:"Command Ops",description:"Manage operations.",selected_authorities:[],administrator_keys:["ceo","director"]}]}}],
 ["corp:hr-state",{workspace:{workspace_id:"smoke-workspace"},categories:[],applications:[],transport:"sage-online-desktop"}],
 ["corp:discord-state",{workspace:{workspace_id:"smoke-workspace",can_manage_fleet_ops:false},status:{integration:null,link:null,notificationCharacters:[],linkedUserCount:0,canManage:false,inviteUrl:null,botInstalled:false,channelAccessible:false}}]
];
for(const [channel,value] of handlers)ipcMain.handle(channel,()=>value);

ipcMain.handle("universe:resolve-type-ids",(_e,ids)=>{
 const names=new Map([[35835,"Athanor"],[35825,"Raitaru"],[30000106,"Shedoo"],[670,"Capsule"],[60012133,"Home Station"]]);
 return (ids||[]).map(id=>({id,name:names.get(Number(id))||("ID "+id)}));
});
ipcMain.handle("market:quote-depth",(_e,input)=>{
 const items=(input?.items||[]).map((item,index)=>({inputName:item.name,itemName:item.name,typeId:1000+index,requestedQuantity:item.quantity,filledQuantity:item.quantity,unfilledQuantity:0,highestBidUsed:100,lowestBidCrossed:100,weightedAverageRealisedUnitPrice:100,ordersCrossed:1,totalRealisedIsk:item.quantity*100,fullMarketDepthSufficient:true}));
 return {createdAt:new Date().toISOString(),locationName:"Jita IV - Moon 4 - Caldari Navy Assembly Plant",source:{kind:"corp-command-smoke",createdAt:new Date().toISOString(),freshRequested:false},items,grandTotalRealisedIsk:items.reduce((s,x)=>s+x.totalRealisedIsk,0),totalUnfilledQuantity:0,fullMarketDepthSufficient:true};
});

(async()=>{
 await app.whenReady();
 const rendererGone=[];
 const consoleErrors=[];
 const win=new BrowserWindow({width:1600,height:1000,show:false,webPreferences:{preload:path.resolve(__dirname,"../dist-electron/preload.js"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.on("console-message",(_e,level,message)=>{if(level>=3)consoleErrors.push(message);});
 win.webContents.on("render-process-gone",(_e,details)=>rendererGone.push(details));
 await win.loadFile(path.resolve(__dirname,"../dist/index.html"));
 await sleep(1200);
 await js(win,'localStorage.removeItem("new-eden-sage-watched-systems")');
 exposeCorpSnapshots=true;
 const clicked=await js(win,'(()=>{const b=[...document.querySelectorAll("button")].find(n=>n.textContent.trim()==="Corporation Command");if(!b)return false;b.click();return true;})()');
 if(!clicked){const labels=await js(win,'[...document.querySelectorAll("button")].map(n=>n.textContent.trim()).filter(Boolean).slice(0,80)');throw new Error("Corporation Command navigation not found. Buttons: "+JSON.stringify(labels));}
 await sleep(300);

 async function clickTab(label){
  const code='(()=>{const label='+JSON.stringify(label)+';const b=[...document.querySelectorAll(".corp-subtabs button")].find(n=>n.textContent.trim()===label);if(!b)return false;b.click();return true;})()';
  if(!await js(win,code))throw new Error("Missing Corporation Command tab: "+label);
  await sleep(180);
 }
 const results={};
 results.systemNews=await js(win,'document.body.textContent.includes("System News")');
 if(!results.systemNews)throw new Error("System News did not render");

 await clickTab("Find a Home");
 results.findHome=await js(win,'document.body.textContent.includes("Find a Home")||document.body.textContent.includes("Rank homes")');
 if(!results.findHome)throw new Error("Find a Home did not render");

 await clickTab("Overview");
 results.overview=await js(win,'(()=>({corp:document.body.textContent.includes("Graybeard Cartel"),tax:document.body.textContent.includes("3%"),members:[...document.querySelectorAll(".corp-overview-grid article")].some(n=>/Members/.test(n.textContent)&&/51/.test(n.textContent)),structures:[...document.querySelectorAll(".corp-overview-grid article")].some(n=>/Structures/.test(n.textContent)&&/2/.test(n.textContent)),assets:document.body.textContent.includes("346"),blueprints:document.body.textContent.includes("57")}))()');
 if(!Object.values(results.overview).every(Boolean))throw new Error("Overview did not use merged fresh corp data: "+JSON.stringify(results.overview));

 const selectedAj=await js(win,'(()=>{const s=document.querySelector(".corp-data-actions select");if(!s)return false;const o=[...s.options].find(x=>x.textContent.includes("Ajdeathgiver"));if(!o)return false;s.value=o.value;s.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
 if(!selectedAj)throw new Error("Could not switch authority to Ajdeathgiver");
 await sleep(180);

 await clickTab("Members");
 results.members=await js(win,'(()=>({heading:document.body.textContent.includes("51 ESI members"),rows:document.querySelectorAll(".member-row").length}))()');
 if(!results.members.heading||results.members.rows!==51)throw new Error("Members did not use merged fresh data: "+JSON.stringify(results.members));

 await clickTab("Op Planner");
 results.ops=await js(win,'Boolean(document.querySelector(".corp-op-planner"))');
 if(!results.ops)throw new Error("Op Planner did not render");

 await clickTab("Corp Roles");
 results.roles=await js(win,'Boolean(document.querySelector(".corp-roles-page"))');
 if(!results.roles)throw new Error("Corp Roles did not render");

 await clickTab("HR");
 results.hr=await js(win,'document.body.textContent.includes("HR")');
 if(!results.hr)throw new Error("HR did not render");

 await clickTab("Corp Ore Buyback");
 results.buyback=await js(win,'(()=>({visible:Boolean(document.querySelector(".corp-buyback")),payout:document.querySelector(".corp-buyback input[type=number]")?.value||""}))()');
 if(!results.buyback.visible||results.buyback.payout!=="90")throw new Error("Corp Ore Buyback did not render");

 await clickTab("Structures");
 results.structures=await js(win,'(()=>({cards:document.querySelectorAll(".structure-card").length,names:[...document.querySelectorAll(".structure-card h3")].map(n=>n.textContent.trim()),types:[...document.querySelectorAll(".structure-card-body>strong")].map(n=>n.textContent.trim()),facilities:[...document.querySelectorAll(".compact-grid article")].map(n=>n.textContent.trim()),body:document.body.textContent}))()');
 if(results.structures.cards!==2)throw new Error("Expected 2 structures with stale Aj selected: "+JSON.stringify(results.structures));
 if(!results.structures.names.includes("Shedoo - Diabolical")||!results.structures.names.includes("Shedoo - Femboi Palace"))throw new Error("Missing structure names");
 if(!results.structures.types.includes("Athanor")||!results.structures.types.includes("Raitaru"))throw new Error("Structure types unresolved: "+JSON.stringify(results.structures.types));
 if(!results.structures.facilities.some(x=>x.includes("Shedoo")))throw new Error("Facility system_id did not resolve to Shedoo: "+JSON.stringify(results.structures.facilities));
 if(!results.structures.body.includes("28/10/2026")&&!results.structures.body.includes("10/28/2026"))throw new Error("Fresh Athanor fuel expiry was not used");

 await clickTab("Alliance Management");
 results.alliance=await js(win,'document.body.textContent.includes("Alliance Management")');
 if(!results.alliance)throw new Error("Alliance Management did not render");

 await clickTab("Discord Setup");
 results.discord=await js(win,'document.body.textContent.includes("Discord")');
 if(!results.discord)throw new Error("Discord Setup did not render");

 if(discordWriteAttempts.length)throw new Error("FORBIDDEN Discord write attempted: "+JSON.stringify(discordWriteAttempts));
 if(rendererGone.length)throw new Error("Renderer exited: "+JSON.stringify(rendererGone));
 console.log(JSON.stringify({tabs:results,discordWriteAttempts:discordWriteAttempts.length,consoleErrorCount:consoleErrors.length,consoleErrors:consoleErrors.slice(0,8)},null,2));
 win.destroy();app.exit(0);
})().catch(error=>{console.error(error?.stack||error);app.exit(1);});
