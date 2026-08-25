import type { SageEnv } from "../types";

type DiscordChannel={id:string;name?:string;type?:number;position?:number;parent_id?:string|null;guild_id?:string};
type DiscordRole={id:string;name?:string;position?:number;color?:number;managed?:boolean;mentionable?:boolean;permissions?:string};
type DiscordUser={id:string;username?:string;global_name?:string|null;bot?:boolean};
type DiscordGuildMember={user?:DiscordUser;nick?:string|null;roles?:string[]};
type DiscordMessage={id?:string;content?:string;author?:DiscordUser};
export type DiscordMentionRole={id:string;name:string;position:number;color:number;managed:boolean;mentionable:boolean};
export type DiscordMentionMember={id:string;username:string;globalName:string|null;displayName:string;roleIds:string[]};
export type DiscordGuildStructure={
  guildId:string;
  guildName:string;
  categories:Array<{id:string;name:string;position:number;channels:Array<{id:string;name:string;type:number;position:number}>}>;
  uncategorized:Array<{id:string;name:string;type:number;position:number}>;
  sendableChannelIds:string[];
  roles:DiscordMentionRole[];
  members:DiscordMentionMember[];
  membersAvailable:boolean;
  membersTruncated:boolean;
};

const DISCORD_API="https://discord.com/api/v10";

export async function discordBotRequest(env:SageEnv,path:string,init:RequestInit={}){
  const token=String(env.DISCORD_BOT_TOKEN??"").trim();
  if(!token)throw new Error("SageBot is not configured on Sage Online.");
  const headers=new Headers(init.headers);
  headers.set("Authorization",`Bot ${token}`);
  headers.set("Content-Type","application/json");
  const response=await fetch(`${DISCORD_API}${path}`,{...init,headers});
  const body=await response.json().catch(()=>({})) as Record<string,unknown>;
  if(!response.ok){
    const message=typeof body.message==="string"?body.message:`Discord request failed (${response.status}).`;
    throw new Error(`Discord: ${message}`);
  }
  return body;
}

export function discordGuildInviteUrl(clientId:string,guildId:string){
  if(!clientId||!guildId)return null;
  const url=new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id",clientId);
  url.searchParams.set("scope","bot applications.commands");
  // View Channel + Send Messages + Read Message History + Mention @everyone/@here/All Roles.
  url.searchParams.set("permissions","199680");
  url.searchParams.set("guild_id",guildId);
  url.searchParams.set("disable_guild_select","true");
  return url.toString();
}

export async function discordInstallationState(env:SageEnv,guildId:string,channelId:string){
  if(!guildId)return {botInstalled:false,channelAccessible:false};
  try{
    await discordBotRequest(env,`/guilds/${encodeURIComponent(guildId)}`);
  }catch{return {botInstalled:false,channelAccessible:false};}
  if(!channelId)return {botInstalled:true,channelAccessible:false};
  try{
    const channel=await discordBotRequest(env,`/channels/${encodeURIComponent(channelId)}`);
    return {botInstalled:true,channelAccessible:String(channel.guild_id??"")===guildId};
  }catch{return {botInstalled:true,channelAccessible:false};}
}

async function readDiscordGuildMembers(env:SageEnv,guildId:string){
  const members:DiscordMentionMember[]=[];
  let after="";
  let truncated=false;
  try{
    for(let page=0;page<10;page++){
      const suffix=after?`&after=${encodeURIComponent(after)}`:"";
      const raw=await discordBotRequest(env,`/guilds/${encodeURIComponent(guildId)}/members?limit=1000${suffix}`);
      const batch=Array.isArray(raw)?raw as DiscordGuildMember[]:[];
      for(const member of batch){
        const user=member.user;
        const userId=String(user?.id??"");
        if(!userId||user?.bot)continue;
        const username=String(user?.username??userId);
        const globalName=user?.global_name?String(user.global_name):null;
        const displayName=String(member.nick??globalName??username);
        members.push({id:userId,username,globalName,displayName,roleIds:Array.isArray(member.roles)?member.roles.map(String):[]});
      }
      if(batch.length<1000)break;
      after=String(batch.at(-1)?.user?.id??"");
      if(!after)break;
      if(page===9)truncated=true;
    }
    members.sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.username.localeCompare(b.username));
    return {members,membersAvailable:true,membersTruncated:truncated};
  }catch{
    return {members:[],membersAvailable:false,membersTruncated:false};
  }
}

export async function readDiscordGuildStructure(env:SageEnv,guildId:string):Promise<DiscordGuildStructure>{
  const guild=await discordBotRequest(env,`/guilds/${encodeURIComponent(guildId)}`);
  const [rawChannels,rawRoles,memberState]=await Promise.all([
    discordBotRequest(env,`/guilds/${encodeURIComponent(guildId)}/channels`),
    discordBotRequest(env,`/guilds/${encodeURIComponent(guildId)}/roles`),
    readDiscordGuildMembers(env,guildId),
  ]);
  const channels=Array.isArray(rawChannels)?rawChannels as DiscordChannel[]:[];
  const roles=Array.isArray(rawRoles)?rawRoles as DiscordRole[]:[];
  const categories=channels.filter(channel=>Number(channel.type)===4).map(category=>({
    id:String(category.id),name:String(category.name??"Category"),position:Number(category.position??0),
    channels:channels.filter(channel=>String(channel.parent_id??"")===String(category.id)&&(Number(channel.type)===0||Number(channel.type)===5)).map(channel=>({id:String(channel.id),name:String(channel.name??channel.id),type:Number(channel.type??0),position:Number(channel.position??0)})).sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name)),
  })).sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name));
  const uncategorized=channels.filter(channel=>!channel.parent_id&&(Number(channel.type)===0||Number(channel.type)===5)).map(channel=>({id:String(channel.id),name:String(channel.name??channel.id),type:Number(channel.type??0),position:Number(channel.position??0)})).sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name));
  const sendableChannelIds=[...uncategorized.map(channel=>channel.id),...categories.flatMap(category=>category.channels.map(channel=>channel.id))];
  const mentionRoles=roles
    .filter(role=>String(role.id)!==guildId)
    .map(role=>({id:String(role.id),name:String(role.name??role.id),position:Number(role.position??0),color:Number(role.color??0),managed:Boolean(role.managed),mentionable:Boolean(role.mentionable)}))
    .filter(role=>!role.managed)
    .sort((a,b)=>b.position-a.position||a.name.localeCompare(b.name));
  return {guildId,guildName:String(guild.name??guildId),categories,uncategorized,sendableChannelIds,roles:mentionRoles,...memberState};
}

export async function deleteDiscordChannelMessage(env:SageEnv,channelId:string,messageId:string){
  if(!channelId||!messageId)return {deleted:false,missing:true};
  try{await discordBotRequest(env,`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,{method:"DELETE"});return {deleted:true,missing:false};}
  catch(cause){const message=cause instanceof Error?cause.message:String(cause);if(/Unknown Message|404/i.test(message))return {deleted:false,missing:true};throw cause;}
}

export async function findDiscordOperationAnnouncement(env:SageEnv,channelId:string,title:string){
  const marker=`**NEW CORPORATION OPERATION - ${String(title||"Corporation Operation").trim()||"Corporation Operation"}**`;
  const me=await discordBotRequest(env,"/users/@me");
  const botId=String(me.id??"");
  if(!botId)return null;
  let before="";
  for(let page=0;page<5;page++){
    const suffix=before?`&before=${encodeURIComponent(before)}`:"";
    const raw=await discordBotRequest(env,`/channels/${encodeURIComponent(channelId)}/messages?limit=100${suffix}`);
    const batch=Array.isArray(raw)?raw as DiscordMessage[]:[];
    const found=batch.find(message=>String(message.author?.id??"")===botId&&String(message.content??"").includes(marker));
    if(found?.id)return {channelId,messageId:String(found.id)};
    if(batch.length<100)break;
    before=String(batch.at(-1)?.id??"");if(!before)break;
  }
  return null;
}

export async function sendDiscordChannelMessage(env:SageEnv,channelId:string,content:string,options?:{mentionEveryone?:boolean;roleIds?:string[];userIds?:string[]}){
  const roleIds=[...new Set((options?.roleIds??[]).map(String).filter(Boolean))].slice(0,100);
  const userIds=[...new Set((options?.userIds??[]).map(String).filter(Boolean))].slice(0,100);
  const mentionEveryone=Boolean(options?.mentionEveryone)&&roleIds.length===0&&userIds.length===0;
  return discordBotRequest(env,`/channels/${encodeURIComponent(channelId)}/messages`,{
    method:"POST",
    body:JSON.stringify({
      content,
      allowed_mentions:{parse:mentionEveryone?["everyone"]:[],roles:roleIds,users:userIds,replied_user:false},
    }),
  });
}

export async function sendDiscordDmToCharacter(env:SageEnv,workspaceId:string,characterId:number,content:string){
  const link=await env.DB.prepare("SELECT discord_user_id FROM discord_notification_targets WHERE workspace_id=?1 AND eve_character_id=?2 AND enabled=1 ORDER BY updated_at DESC LIMIT 1").bind(workspaceId,characterId).first<{discord_user_id:string}>();
  if(!link)return {sent:false,reason:"not_linked"};
  const dm=await discordBotRequest(env,"/users/@me/channels",{method:"POST",body:JSON.stringify({recipient_id:link.discord_user_id})});
  const channelId=String(dm.id??"");
  if(!channelId)throw new Error("Discord did not return a DM channel.");
  const message=await sendDiscordChannelMessage(env,channelId,content);
  return {sent:true,discordUserId:link.discord_user_id,messageId:String(message.id??"")};
}
