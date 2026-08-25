import { useEffect, useMemo, useState } from "react";
import "./corp-roles-compact.css";

type CorpRecord={characterId:string;characterName:string;corporationId:number;name:string;snapshot?:any;data?:any};
type RoleOption={key:string;label:string};
type TitleOption={value:string;label:string};
type Authority={type:"eve_role"|"eve_title";value:string};
type PermissionPolicy={key:string;label:string;description:string;selected_authorities?:Authority[];selected_role_keys?:string[];selected_title_values?:string[];administrator_keys:string[]};
type PolicyState={can_configure:boolean;is_corporation_ceo:boolean;is_director:boolean;administrators:Array<{key:string;label:string;locked:boolean}>;available_roles:RoleOption[];available_titles?:TitleOption[];permissions:PermissionPolicy[]};
type RolesState={workspace:any;policy:PolicyState};

const authorityKey=(authority:Authority)=>`${authority.type}:${authority.value}`;
function selectedFor(permission:PermissionPolicy):Authority[]{if(Array.isArray(permission.selected_authorities))return permission.selected_authorities;return[...(permission.selected_role_keys??[]).map(value=>({type:"eve_role" as const,value})),...(permission.selected_title_values??[]).map(value=>({type:"eve_title" as const,value}))];}

export function CorporationRoles({corporation}:{corporation:CorpRecord}){
  const [state,setState]=useState<RolesState|null>(null);
  const [selected,setSelected]=useState<Record<string,Authority[]>>({});
  const [busyKey,setBusyKey]=useState("");
  const [status,setStatus]=useState("Reading verified corporation roles and titles from Sage Online...");
  const [filters,setFilters]=useState<Record<string,string>>({});
  const [manualValues,setManualValues]=useState<Record<string,string>>({});

  async function load(){try{const next=await window.sage.getCorporationRolesState(corporation.characterId) as RolesState;setState(next);setSelected(Object.fromEntries(next.policy.permissions.map(permission=>[permission.key,selectedFor(permission)])));setStatus(next.policy.can_configure?"Policy administration verified for this CEO / Director character.":"Read-only authority view for the selected character.");}catch(error){setStatus(error instanceof Error?error.message:"Corporation role policy is unavailable.");}}
  useEffect(()=>{void load();},[corporation.characterId]);
  const roleOptions=useMemo(()=>state?.policy.available_roles??[],[state]);
  const titleOptions=useMemo(()=>{const values=new Map<string,TitleOption>();for(const title of state?.policy.available_titles??[])if(title.value.trim())values.set(title.value,{value:title.value,label:title.label||title.value});for(const title of Array.isArray(corporation?.data?.titles)?corporation.data.titles:[]){const name=String(title?.name??"").trim();if(name&&!values.has(name))values.set(name,{value:name,label:name});}return[...values.values()].sort((a,b)=>a.label.localeCompare(b.label));},[state,corporation?.data?.titles]);

  function toggle(permissionKey:string,authority:Authority){if(!state?.policy.can_configure)return;setSelected(current=>{const values=current[permissionKey]??[],key=authorityKey(authority);return{...current,[permissionKey]:values.some(item=>authorityKey(item)===key)?values.filter(item=>authorityKey(item)!==key):[...values,authority]};});}
  function addManual(permissionKey:string,type:"eve_role"|"eve_title"){const key=`${permissionKey}:${type}`,value=(manualValues[key]??"").trim();if(!value||!state?.policy.can_configure)return;setSelected(current=>{const rows=current[permissionKey]??[],authority:Authority={type,value};return rows.some(item=>authorityKey(item)===authorityKey(authority))?current:{...current,[permissionKey]:[...rows,authority]};});setManualValues(current=>({...current,[key]:""}));}
  async function save(permission:PermissionPolicy){if(!state?.policy.can_configure)return;setBusyKey(permission.key);try{const result=await window.sage.updateCorporationRolePermission({characterId:corporation.characterId,permissionKey:permission.key,authorities:selected[permission.key]??[]}) as RolesState;setState(result);setSelected(Object.fromEntries(result.policy.permissions.map(row=>[row.key,selectedFor(row)])));setStatus(`${permission.label} authority saved.`);}catch(error){setStatus(error instanceof Error?error.message:"Corporation permission update failed.");}finally{setBusyKey("");}}

  function AuthorityGroup({permission,type,label,options}:{permission:PermissionPolicy;type:"eve_role"|"eve_title";label:string;options:Array<{value:string;label:string;sub:string}>}){
    const active=selected[permission.key]??[],activeKeys=new Set(active.map(authorityKey));
    const manualKey=`${permission.key}:${type}`;
    return <div className="corp-authority-group">
      <div className="corp-authority-group-head"><strong>{label}</strong><small>{options.length} observed / saved</small></div>
      <div className="corp-authority-manual-compact"><input value={manualValues[manualKey]??""} onChange={event=>setManualValues(current=>({...current,[manualKey]:event.target.value}))} placeholder={type==="eve_role"?"Exact EVE role key...":"Exact corporation title..."}/><button disabled={!state?.policy.can_configure} onClick={()=>addManual(permission.key,type)}>Add</button></div>
      <div className="corp-authority-option-grid">{options.map(option=>{const authority:Authority={type,value:option.value},checked=activeKeys.has(authorityKey(authority));return <label key={option.value} className={checked?"selected":""}><input type="checkbox" checked={checked} disabled={!state?.policy.can_configure} onChange={()=>toggle(permission.key,authority)}/><span><strong>{option.label}</strong><small>{option.sub}</small></span></label>;})}{!options.length&&<div className="corp-authority-empty">No corporation {type==="eve_role"?"roles":"titles"} available.</div>}</div>
    </div>;
  }

  return <div className="corp-roles-page compact">
    <header className="corp-roles-compact-head"><div><p className="eyebrow">CORPORATION · OPERATION AUTHORITY</p><h3>Corp Roles</h3><p>Choose the real EVE roles and corporation titles that can create/manage operations and approve applications.</p></div><button onClick={()=>void load()} disabled={Boolean(busyKey)}>Refresh</button></header>
    <div className="corp-roles-compact-status">{status}</div>
    {!state?<div className="system-empty">Connect a verified corporation character to load operation authority.</div>:<>
      <section className="corp-policy-admin-strip"><div><p className="eyebrow">POLICY ADMINISTRATORS</p><strong>CEO & Directors</strong><span>Always retain policy administration so the corporation cannot lock itself out.</span></div><div>{state.policy.administrators.map(admin=><span key={admin.key}>{admin.label}</span>)}</div></section>
      <div className="corp-permission-stack">{state.policy.permissions.map(permission=>{
        const active=selected[permission.key]??[],filter=(filters[permission.key]??"").trim().toLowerCase();
        const roles=roleOptions.filter(role=>!filter||role.label.toLowerCase().includes(filter)||role.key.toLowerCase().includes(filter)).map(role=>({value:role.key,label:role.label,sub:role.key}));
        const titles=titleOptions.filter(title=>!filter||title.label.toLowerCase().includes(filter)).map(title=>({value:title.value,label:title.label,sub:"EVE corporation title"}));
        const roleCount=active.filter(item=>item.type==="eve_role").length,titleCount=active.filter(item=>item.type==="eve_title").length;
        return <section className="corp-permission-structure" key={permission.key}>
          <div className="corp-permission-structure-head"><div><p className="eyebrow">SAGE PERMISSION</p><h4>{permission.label}</h4><p>{permission.description}</p></div><span>{active.length} SELECTED</span></div>
          <div className="corp-permission-toolbar"><div><b>{roleCount}</b> roles <b>{titleCount}</b> titles</div><input value={filters[permission.key]??""} onChange={event=>setFilters(current=>({...current,[permission.key]:event.target.value}))} placeholder="Filter roles or titles..."/><button disabled={!state.policy.can_configure} onClick={()=>setSelected(current=>({...current,[permission.key]:[]}))}>Clear all</button></div>
          <div className="corp-authority-structure-grid"><AuthorityGroup permission={permission} type="eve_role" label="EVE roles" options={roles}/><AuthorityGroup permission={permission} type="eve_title" label="Corporation titles" options={titles}/></div>
          <div className="corp-permission-save"><small>{state.policy.can_configure?"Save exactly the authority selection above.":"The selected character can use granted permissions but cannot change the policy."}</small><button className="primary" disabled={!state.policy.can_configure||Boolean(busyKey)} onClick={()=>void save(permission)}>{busyKey===permission.key?"Saving...":"Save authority"}</button></div>
        </section>;
      })}</div>
    </>}
  </div>;
}
