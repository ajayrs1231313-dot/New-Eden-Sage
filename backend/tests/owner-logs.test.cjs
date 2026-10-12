const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs"),path=require("path"),vm=require("vm"),esbuild=require("../node_modules/esbuild");
function load(file,deps={}){
  const js=esbuild.transformSync(fs.readFileSync(file,"utf8"),{loader:"ts",format:"cjs",target:"es2022"}).code;
  const exp={};const mod={exports:exp};vm.runInNewContext(js,{exports:exp,module:mod,require:n=>deps[n],Response,URL,crypto:require("crypto").webcrypto});return mod.exports;
}
const root=path.join(__dirname,"..","src"),policy=load(path.join(root,"strategic-policy.ts"));
const logs=load(path.join(root,"owner-logs.ts"),{"./strategic-policy":policy});
const owner={accountId:"569399317",sessionId:"s"},guest={accountId:"guest",sessionId:"g"};
function fixture(){
 const calls=[];
 const env={DB:{prepare(sql){return {all:async()=>({results:[{account_id:"guest",character_name:"Test",ai_count:1,failure_count:1,browser_count:0}]}),bind(...values){calls.push({sql,values});return {
   first:async()=>values[0]==="569399317"?{id:"569399317"}:null,
   all:async()=>({results:sql.includes("WITH active AS")?[{account_id:"guest",character_name:"Test",ai_count:1,failure_count:1,browser_count:0}]:[{account_id:"guest",request_id:"sai_one",session_id:"sess",prompt_text:"full prompt"}]}),
   run:async()=>({success:true})
 }}}}}};return{env,calls};
}
test("nonowner denied",async()=>{
 const {env,calls}=fixture(),u=new URL("https://sage.test/v1/owner/logs/users");
 const r=await logs.handleOwnerLogsApi(new Request(u),env,guest,u);
 assert.equal(r.status,404);assert.equal(calls.length,0);
});
test("verified owner can list account IDs",async()=>{
 const {env}=fixture(),u=new URL("https://sage.test/v1/owner/logs/users");
 const r=await logs.handleOwnerLogsApi(new Request(u),env,owner,u);
 assert.equal(r.status,200);assert.equal((await r.json()).users[0].account_id,"guest");
});
test("export preserves identifiers and audits",async()=>{
 const {env,calls}=fixture(),u=new URL("https://sage.test/v1/owner/logs/export?source=ai&accountId=guest");
 const r=await logs.handleOwnerLogsApi(new Request(u),env,owner,u),j=await r.json();
 assert.equal(r.status,200);assert.equal(j.rows[0].session_id,"sess");
 assert.ok(calls.some(c=>c.sql.includes("owner_log_export_audit")&&c.values[2]==="guest"));
});
test("unknown log source denied",async()=>{
 const {env}=fixture(),u=new URL("https://sage.test/v1/owner/logs/export?source=other&accountId=all");
 const r=await logs.handleOwnerLogsApi(new Request(u),env,owner,u);
 assert.equal(r.status,400);
});
