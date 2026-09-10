const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {spawn}=require("node:child_process");
const {DatabaseSync}=require("node:sqlite");
const root=path.resolve(".tmp-mcp-electron-mode");
fs.rmSync(root,{recursive:true,force:true});fs.mkdirSync(root,{recursive:true});
const key=Buffer.alloc(32,11).toString("base64");
const {protectCurrentUserDpapi}=require("../dist-electron/windows-dpapi.js");
fs.writeFileSync(path.join(root,"settings.json"),JSON.stringify({dpapiPrivateDataKey:protectCurrentUserDpapi(key)},null,2));
const db=new DatabaseSync(path.join(root,"new-eden-sage.sqlite"));
db.exec("CREATE TABLE IF NOT EXISTS character_snapshots(character_id TEXT PRIMARY KEY,character_name TEXT NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS imported_information(id INTEGER PRIMARY KEY AUTOINCREMENT,source_name TEXT NOT NULL,content TEXT NOT NULL,imported_at TEXT NOT NULL);");db.close();
const exe=path.resolve("node_modules/electron/dist/electron.exe");
const script=path.resolve("dist-electron/mcp-cli.js");
const child=spawn(exe,[script],{cwd:path.resolve("."),windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:"1",NEW_EDEN_SAGE_USER_DATA:root},stdio:["pipe","pipe","pipe"]});
let out="",err="";child.stdout.on("data",c=>out+=String(c));child.stderr.on("data",c=>err+=String(c));
function send(obj){child.stdin.write(JSON.stringify(obj)+"\n")}
send({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"sage-test",version:"1"}}});
setTimeout(()=>send({jsonrpc:"2.0",method:"notifications/initialized",params:{}}),100);
setTimeout(()=>send({jsonrpc:"2.0",id:2,method:"tools/list",params:{}}),180);
const deadline=Date.now()+8000;let done=false;
const timer=setInterval(()=>{if(out.includes('"id":2')&&out.includes('"tools"'))finish();else if(Date.now()>deadline)finish(new Error("MCP timeout: "+err+" OUT="+out.slice(-2000)));},50);
function finish(error){if(done)return;done=true;clearInterval(timer);child.kill();setTimeout(()=>{assert.ifError(error);assert.ok(out.includes('"id":1'),"initialize response missing");assert.ok(out.includes('"id":2'),"tools/list response missing");assert.ok(out.includes("get_character_data"),"Sage MCP tools were not listed");console.log("Node-mode MCP DPAPI/safe-storage compatibility smoke check passed");},150);}
child.on("error",finish);child.on("exit",code=>{if(!done&&code!==null)finish(new Error("MCP exited early "+code+": "+err));});
