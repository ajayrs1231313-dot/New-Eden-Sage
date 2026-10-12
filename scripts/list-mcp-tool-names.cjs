
const path=require("node:path");
const {Client}=require("@modelcontextprotocol/sdk/client/index.js");
const {StdioClientTransport}=require("@modelcontextprotocol/sdk/client/stdio.js");
(async()=>{
 const electron=path.join(process.cwd(),"node_modules","electron","dist","electron.exe");
 const cli=path.join(process.cwd(),"dist-electron","mcp-cli.js");
 const transport=new StdioClientTransport({command:electron,args:[cli],env:{...process.env,ELECTRON_RUN_AS_NODE:"1",NEW_EDEN_SAGE_USER_DATA:path.join(process.env.APPDATA,"new-eden-sage")},stderr:"pipe"});
 const client=new Client({name:"tool-list",version:"1"});
 await client.connect(transport);
 const r=await client.listTools();
 console.log(r.tools.map(t=>t.name).sort().join("\n"));
 await client.close();
})().catch(e=>{console.error(e);process.exit(1)});
