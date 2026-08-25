import { useEffect, useMemo, useState } from "react";
import "./corp-discord-polish.css";

type CorpRecord={characterId:string;characterName:string;corporationId:number;name:string};
type DiscordRole={id:string;name:string;position:number;color:number;managed:boolean;mentionable:boolean};
type DiscordChannel={id:string;name:string;type:number;position:number};
type DiscordServerStructure={guildId:string;guildName:string;categories:Array<{id:string;name:string;position:number;channels:DiscordChannel[]}>;uncategorized:DiscordChannel[];sendableChannelIds:string[];roles:DiscordRole[];members:Array<{id:string;username:string;globalName:string|null;displayName:string;roleIds:string[]}>;membersAvailable:boolean;membersTruncated:boolean};
type DiscordState={
  workspace:any;
  status:{
    integration:null|{guildId:string;channelId:string;allowedChannelIds:string[];enabled:boolean;updatedAt?:string};
    link:null|{discordUserId:string;username:string;globalName?:string|null;dmEnabled:boolean;linkedAt?:string;linkedViaCharacterId?:number};
    notificationCharacters?:Array<{characterId:number;characterName:string;enabled:boolean}>;
    linkedUserCount:number;
    canManage:boolean;
    inviteUrl?:string|null;
    botInstalled?:boolean;
    channelAccessible?:boolean;
  };
};

function ChannelRow({channel,allowed,isDefault,disabled,onToggle,onDefault}:{channel:DiscordChannel;allowed:boolean;isDefault:boolean;disabled:boolean;onToggle:()=>void;onDefault:()=>void}){
  return <div className={`discord-channel-row ${allowed?"allowed":""} ${isDefault?"default":""}`}>
    <label><input type="checkbox" checked={allowed} disabled={disabled} onChange={onToggle}/><span><strong>#{channel.name}</strong><small>{channel.type===5?"Announcement channel":"Text channel"}</small></span></label>
    <button disabled={disabled||!allowed||isDefault} onClick={onDefault}>{isDefault?"DEFAULT":"Make default"}</button>
  </div>;
}

export function CorporationDiscordIntegration({corporation}:{corporation:CorpRecord}){
  const [data,setData]=useState<DiscordState|null>(null);
  const [structure,setStructure]=useState<DiscordServerStructure|null>(null);
  const [guildId,setGuildId]=useState("");
  const [channelId,setChannelId]=useState("");
  const [allowedChannelIds,setAllowedChannelIds]=useState<string[]>([]);
  const [enabled,setEnabled]=useState(false);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("Reading Discord state from Sage Online...");
  const [notificationCharacters,setNotificationCharacters]=useState<number[]>([]);
  const [announcement,setAnnouncement]=useState("");
  const [announcementChannelId,setAnnouncementChannelId]=useState("");
  const [announcementRoleIds,setAnnouncementRoleIds]=useState<string[]>([]);
  const [announcementUserIds,setAnnouncementUserIds]=useState<string[]>([]);
  const [announcementRoleQuery,setAnnouncementRoleQuery]=useState("");
  const [announcementMemberQuery,setAnnouncementMemberQuery]=useState("");

  async function load(forCharacterId=corporation.characterId){
    try{
      const next=await window.sage.getCorporationDiscordState(forCharacterId) as DiscordState;
      setData(next);
      const integration=next.status.integration;
      setGuildId(integration?.guildId??"");
      setChannelId(integration?.channelId??"");
      setAllowedChannelIds(integration?.allowedChannelIds??[]);
      setEnabled(Boolean(integration?.enabled));
      setNotificationCharacters((next.status.notificationCharacters??[]).filter(row=>row.enabled).map(row=>row.characterId));
      setAnnouncementChannelId(current=>current||integration?.channelId||"");
      if(next.status.canManage&&next.status.botInstalled){
        try{
          const server=await window.sage.getCorporationDiscordServerStructure(forCharacterId) as DiscordServerStructure;
          setStructure(server);
        }catch{setStatus("SageBot server details are temporarily unavailable. Keeping the last good Discord view.");}
      }else setStructure(null);
      if(next.status.link)setStatus(`Discord linked to ${next.status.link.globalName||next.status.link.username}.`);
      else setStatus("Link your Discord account to receive personal Sage alerts.");
    }catch(error){setStatus(data?"Sage Online connection dipped briefly. Keeping your last good Discord state and draft; Refresh will retry.":error instanceof Error?error.message:"Discord state is unavailable.");}
  }

  useEffect(()=>{void load();},[corporation.characterId]);
  useEffect(()=>{
    const refresh=()=>void load();
    window.addEventListener("focus",refresh);
    const visibility=()=>{if(document.visibilityState==="visible")refresh();};
    document.addEventListener("visibilitychange",visibility);
    return()=>{window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",visibility);};
  },[corporation.characterId]);

  const state=data?.status;
  const manage=data?.workspace?.can_manage_fleet_ops===true&&state?.canManage===true;
  const allowedSet=useMemo(()=>new Set(allowedChannelIds),[allowedChannelIds]);
  const channels=useMemo(()=>structure?[...structure.uncategorized,...structure.categories.flatMap(category=>category.channels)]:[],[structure]);
  const availableAllowedChannels=channels.filter(row=>allowedSet.has(row.id));
  const notificationOptions=state?.notificationCharacters??[];
  const filteredAnnouncementRoles=useMemo(()=>{const q=announcementRoleQuery.trim().toLowerCase();return (structure?.roles??[]).filter(role=>!q||role.name.toLowerCase().includes(q));},[structure,announcementRoleQuery]);
  const filteredAnnouncementMembers=useMemo(()=>{const q=announcementMemberQuery.trim().toLowerCase();return (structure?.members??[]).filter(member=>!q||member.displayName.toLowerCase().includes(q)||member.username.toLowerCase().includes(q)||(member.globalName??'').toLowerCase().includes(q));},[structure,announcementMemberQuery]);

  function toggleAllowed(id:string){
    setAllowedChannelIds(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);
    if(channelId===id&&allowedSet.has(id))setChannelId("");
  }
  function makeDefault(id:string){if(!allowedSet.has(id))return;setChannelId(id);setAnnouncementChannelId(id);}
  function toggleRole(id:string){setAnnouncementRoleIds(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);}
  function toggleAnnouncementUser(id:string){setAnnouncementUserIds(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);}

  async function save(){
    if(!manage)return;
    setBusy(true);
    try{
      const result=await window.sage.configureCorporationDiscord({characterId:corporation.characterId,guildId:guildId.trim(),channelId:channelId.trim(),allowedChannelIds,enabled}) as any;
      setStatus("Corporation Discord routing saved and verified by Sage Online.");
      await load(corporation.characterId);
      return result;
    }catch(error){setStatus(error instanceof Error?error.message:"Discord configuration failed.");}
    finally{setBusy(false);}
  }

  async function linkDiscord(){
    setBusy(true);
    try{const result=await window.sage.getCorporationDiscordLinkUrl(corporation.characterId);window.open(result.url,"_blank","noopener,noreferrer");setStatus("Discord authorization opened. Sage will refresh the linked state when you return.");}
    catch(error){setStatus(error instanceof Error?error.message:"Discord linking could not start.");}
    finally{setBusy(false);}
  }
  async function testDm(){setBusy(true);try{await window.sage.testCorporationDiscordDm(corporation.characterId);setStatus("Test DM sent to the Discord account used by this character's notification route.");}catch(error){setStatus(error instanceof Error?error.message:"Discord test DM failed.");}finally{setBusy(false);}}
  async function unlink(){setBusy(true);try{await window.sage.unlinkCorporationDiscord(corporation.characterId);setStatus("Discord account unlinked from this corporation workspace.");await load();}catch(error){setStatus(error instanceof Error?error.message:"Discord unlink failed.");}finally{setBusy(false);}}
  async function saveNotificationCharacters(){
    if(!state?.link)return;
    setBusy(true);
    try{
      await window.sage.updateCorporationDiscordNotificationTargets({characterId:corporation.characterId,characterIds:notificationCharacters});
      setStatus(`Discord notification routing saved for ${notificationCharacters.length} character${notificationCharacters.length===1?"":"s"}.`);
      await load();
    }catch(error){setStatus(error instanceof Error?error.message:"Notification character routing failed.");}
    finally{setBusy(false);}
  }
  async function sendAnnouncement(){
    if(!manage||!announcement.trim())return;
    setBusy(true);
    try{
      await window.sage.sendCorporationDiscordAnnouncement({characterId:corporation.characterId,content:announcement.trim(),channelId:announcementChannelId||channelId,roleIds:announcementRoleIds,userIds:announcementUserIds});
      const targetCount=announcementRoleIds.length+announcementUserIds.length; setStatus(`Custom announcement sent to Discord${targetCount?` for ${announcementRoleIds.length} role${announcementRoleIds.length===1?"":"s"} and ${announcementUserIds.length} member${announcementUserIds.length===1?"":"s"}`:" with @everyone"}.`);
      setAnnouncement("");
    }catch(error){setStatus(error instanceof Error?error.message:"Discord announcement failed.");}
    finally{setBusy(false);}
  }

  return <div className="corp-discord-page">
    <header className="corp-discord-head">
      <div><p className="eyebrow">CORPORATION · DISCORD</p><h3>{manage?"SageBot Command":"My Discord Alerts"}</h3><p>{manage?"One shared SageBot. This corporation's server, channels, mentions and messages stay isolated in Sage Online.":"Link your Discord account and choose which of your corporation characters may send personal Sage notifications to it."}</p></div>
      <button onClick={()=>void load()} disabled={busy}>Refresh</button>
    </header>
    <div className="discord-status-line">{status}</div>

    {manage&&<>
      <section className="discord-health-grid">
        <article className={guildId?"ok":"warn"}><small>CORPORATION SERVER</small><strong>{guildId?"Configured":"Not configured"}</strong><span>{guildId?`Server ${guildId}`:"Save the Discord server ID first."}</span></article>
        <article className={state?.botInstalled?"ok":"warn"}><small>SAGEBOT</small><strong>{state?.botInstalled?"Installed":"Not installed"}</strong><span>{state?.botInstalled?"SageBot can read this server.":"Install the shared bot in this server."}</span></article>
        <article className={state?.channelAccessible?"ok":"warn"}><small>DEFAULT CHANNEL</small><strong>{state?.channelAccessible?"Accessible":"Needs routing"}</strong><span>{channelId?`#${channels.find(row=>row.id===channelId)?.name??channelId}`:"Choose an allowed default channel."}</span></article>
        <article className={enabled?"ok":"warn"}><small>CORP ROUTING</small><strong>{enabled?"Enabled":"Disabled"}</strong><span>{allowedChannelIds.length} allowed channel{allowedChannelIds.length===1?"":"s"}</span></article>
      </section>

      <section className="discord-command-card">
        <div className="discord-section-head"><div><p className="eyebrow">CORPORATION SETTINGS</p><h4>Connect {corporation.name}</h4><p>Save the server, install SageBot, then choose exactly where Sage may talk.</p></div><div className="discord-inline-actions">{state?.inviteUrl&&<button onClick={()=>window.open(String(state.inviteUrl),"_blank","noopener,noreferrer")}>Add SageBot to This Server</button>}{state?.inviteUrl&&<button onClick={()=>void navigator.clipboard.writeText(String(state.inviteUrl)).then(()=>setStatus("Locked SageBot install link copied for the server owner/admin."))}>Copy Install Link</button>}</div></div>
        <div className="discord-connect-grid">
          <label><span>Discord Server / Guild ID</span><input value={guildId} onChange={e=>setGuildId(e.target.value)} placeholder="Server ID"/></label>
          <label className="discord-route-toggle"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/><span><strong>Enable corporation Discord routing</strong><small>Only allowed channels below can be used.</small></span></label>
          <button className="primary" onClick={()=>void save()} disabled={busy||!guildId.trim()}>Save Corporation Discord</button>
        </div>
        <small className="discord-helper">The server owner or anyone with Discord's Manage Server permission can approve SageBot. They do not need Sage installed.</small>
      </section>

      {structure&&<details className="discord-server-map discord-collapse-card">
        <summary className="discord-collapse-summary">
          <span><small>SERVER STRUCTURE · {structure.guildName.toUpperCase()}</small><strong>Where SageBot may talk</strong><em>Choose and manage the channels Sage Online may use.</em></span>
          <span className="discord-collapse-meta"><b>{allowedChannelIds.length} ALLOWED</b><i>▾</i></span>
        </summary>
        <div className="discord-collapse-body">
          <div className="discord-category-grid">
            {structure.uncategorized.length>0&&<div className="discord-category"><div className="discord-category-head"><strong>Uncategorised</strong><small>{structure.uncategorized.length} channels</small></div>{structure.uncategorized.map(channel=><ChannelRow key={channel.id} channel={channel} allowed={allowedSet.has(channel.id)} isDefault={channelId===channel.id} disabled={busy} onToggle={()=>toggleAllowed(channel.id)} onDefault={()=>makeDefault(channel.id)}/>)}</div>}
            {structure.categories.map(category=><div className="discord-category" key={category.id}><div className="discord-category-head"><strong>{category.name}</strong><small>{category.channels.length} channels</small></div>{category.channels.map(channel=><ChannelRow key={channel.id} channel={channel} allowed={allowedSet.has(channel.id)} isDefault={channelId===channel.id} disabled={busy} onToggle={()=>toggleAllowed(channel.id)} onDefault={()=>makeDefault(channel.id)}/>)}</div>)}
          </div>
          <div className="discord-routing-footer"><label><span>Default announcement channel</span><select value={channelId} onChange={e=>setChannelId(e.target.value)}><option value="">Choose an allowed channel</option>{availableAllowedChannels.map(channel=><option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></label><button className="primary" disabled={busy||!channelId||!allowedSet.has(channelId)} onClick={()=>void save()}>Save Routing</button></div>
        </div>
      </details>}

      {structure&&enabled&&availableAllowedChannels.length>0&&<section className="discord-custom-announcement">
        <div className="discord-section-head"><div><p className="eyebrow">LEADERSHIP ANNOUNCEMENT</p><h4>Send a custom announcement</h4><p>Messages still pass through Sage Online's signed command, role, guild and channel checks.</p></div><span className="discord-count-badge">{announcementRoleIds.length+announcementUserIds.length?`${announcementRoleIds.length+announcementUserIds.length} TARGETS`:"@EVERYONE"}</span></div>
        <div className="discord-announcement-grid">
          <label><span>Destination</span><select value={announcementChannelId||channelId} onChange={e=>setAnnouncementChannelId(e.target.value)}>{availableAllowedChannels.map(channel=><option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></label>
          <label className="discord-announcement-message"><span>Announcement</span><textarea value={announcement} maxLength={1700} onChange={e=>setAnnouncement(e.target.value)} placeholder="Corporation announcement..."/><small>{announcement.length}/1700</small></label>
        </div>
        <div className="discord-targeting-head"><strong>Who gets pinged</strong><small>No role selected = @everyone. Selecting any role or member replaces @everyone.</small></div>
        <div className="discord-target-tables">
          <details className="discord-target-table">
            <summary><span><strong>Discord Roles</strong><small>Search and select server roles</small></span><em>{announcementRoleIds.length}/{structure.roles.length}</em></summary>
            <div className="discord-target-table-body"><input className="discord-target-search" value={announcementRoleQuery} onChange={e=>setAnnouncementRoleQuery(e.target.value)} placeholder="Search Discord roles..."/><div className="discord-target-column-head"><span>Role</span><span>Status</span><span>Ping</span></div><div className="discord-target-rows">{filteredAnnouncementRoles.map(role=>{const selected=announcementRoleIds.includes(role.id);return <label key={role.id} className={selected?"selected":""}><span><strong>@{role.name}</strong><small>Discord server role</small></span><em>{role.mentionable?"Mentionable":"Bot permission"}</em><input type="checkbox" checked={selected} onChange={()=>toggleRole(role.id)}/></label>;})}</div></div>
          </details>
          <details className="discord-target-table">
            <summary><span><strong>Discord Server Members</strong><small>Search and ping individual server members</small></span><em>{announcementUserIds.length}/{structure.membersAvailable?structure.members.length:0}</em></summary>
            <div className="discord-target-table-body">{structure.membersAvailable?<><input className="discord-target-search" value={announcementMemberQuery} onChange={e=>setAnnouncementMemberQuery(e.target.value)} placeholder="Search server members..."/><div className="discord-target-column-head"><span>Member</span><span>Discord</span><span>Ping</span></div><div className="discord-target-rows">{filteredAnnouncementMembers.map(member=>{const selected=announcementUserIds.includes(member.id);return <label key={member.id} className={selected?"selected":""}><span><strong>{member.displayName}</strong><small>@{member.username}</small></span><em>Direct mention</em><input type="checkbox" checked={selected} onChange={()=>toggleAnnouncementUser(member.id)}/></label>;})}</div>{structure.membersTruncated&&<small className="discord-members-note">Large server: showing the first 10,000 members returned by Discord.</small>}</>:<div className="discord-members-unavailable"><strong>Server member list unavailable</strong><span>Enable Discord's Server Members Intent for SageBot, then Refresh.</span></div>}</div>
          </details>
        </div>
        <div className="discord-announcement-actions"><span>{announcementRoleIds.length+announcementUserIds.length?`Ping: ${announcementRoleIds.length} role${announcementRoleIds.length===1?"":"s"}, ${announcementUserIds.length} member${announcementUserIds.length===1?"":"s"}`:"Ping: @everyone"}</span><button className="primary" onClick={()=>void sendAnnouncement()} disabled={busy||!announcement.trim()||!(announcementChannelId||channelId)}>Send Announcement</button></div>
      </section>}
    </>}

    <section className={`discord-personal-card ${state?.link?"linked":""}`}>
      <div className="discord-section-head"><div><p className="eyebrow">MY DISCORD ALERTS</p><h4>{corporation.characterName} {state?.link&&<span className="discord-linked-pill">✓ DISCORD LINKED</span>}</h4><p>{state?.link?`Linked to ${state.link.globalName||state.link.username}. Choose which of your characters in ${corporation.name} may route personal Sage alerts to this Discord account.`:"Link one Discord account, then choose which of your corporation characters may send notifications to it."}</p></div><div className="discord-inline-actions">{state?.link?<><button onClick={()=>void testDm()} disabled={busy}>Send Test DM</button><button onClick={()=>void unlink()} disabled={busy}>Unlink Discord</button></>:<button className="primary" onClick={()=>void linkDiscord()} disabled={busy}>Link My Discord</button>}</div></div>
      {state?.link&&notificationOptions.length>0&&<div className="discord-character-routing"><div className="discord-character-routing-head"><strong>Characters sending notifications here</strong><small>{notificationCharacters.length} of {notificationOptions.length} enabled</small></div><div className="discord-character-grid">{notificationOptions.map(row=><label key={row.characterId} className={notificationCharacters.includes(row.characterId)?"selected":""}><input type="checkbox" checked={notificationCharacters.includes(row.characterId)} onChange={()=>setNotificationCharacters(current=>current.includes(row.characterId)?current.filter(id=>id!==row.characterId):[...current,row.characterId])}/><span><strong>{row.characterName}</strong><small>{String(row.characterId)===corporation.characterId?"Currently selected character":"Linked Sage character"}</small></span></label>)}</div><div className="discord-character-actions"><small>Only your own active characters in this corporation can be selected.</small><button className="primary" onClick={()=>void saveNotificationCharacters()} disabled={busy}>Save Notification Characters</button></div></div>}
    </section>
  </div>;
}
