const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');
const ui=read('src/CorporationDiscordIntegration.tsx');
const planner=read('src/CorporationOpPlanner.tsx');
const online=read('electron/sage-online.ts');
const device=read('electron/sage-discord-device.ts');
const main=read('electron/main-task9.ts');
const backend=read('backend/src/index.ts');
const service=read('backend/src/discord/service.ts');
const security=read('backend/src/discord/security.ts');
const migration7=read('backend/migrations/0007_discord_command_security.sql');
const migration8=read('backend/migrations/0008_discord_notification_targets.sql');

test('corp Discord admin follows selected-character Command Ops while ordinary members only receive personal controls',()=>{
  assert.match(ui,/data\?\.workspace\?\.can_manage_fleet_ops===true&&state\?\.canManage===true/);
  assert.match(ui,/\{manage&&<>/);
  assert.match(ui,/MY DISCORD ALERTS/);
  assert.match(ui,/choose which of your corporation characters may send personal Sage notifications/i);
  assert.match(backend,/hasPermission\(env,workspaceId,principal\.accountId,"fleet\.manage",characterId\)/);
  assert.doesNotMatch(ui,/BOT TOKEN|CLIENT SECRET|DISCORD_CLIENT_SECRET|DISCORD_BOT_TOKEN/);
});

test('desktop never calls Discord bot API and all bot traffic is Sage Online owned',()=>{
  const desktop=[online,device,main].join('\n');
  assert.doesNotMatch(desktop,/discord\.com\/api\/v10/);
  assert.match(service,/https:\/\/discord\.com\/api\/v10/);
  assert.match(service,/env\.DISCORD_BOT_TOKEN/);
  assert.doesNotMatch(service,/process\.env|localStorage|safeStorage/);
});

test('Discord credentials, request verification and desktop key material stay separated',()=>{
  assert.match(service,/env\.DISCORD_BOT_TOKEN/);
  assert.doesNotMatch(security,/DISCORD_BOT_TOKEN|DISCORD_CLIENT_SECRET/);
  assert.doesNotMatch(device,/DISCORD_BOT_TOKEN|DISCORD_CLIENT_SECRET|DISCORD_CLIENT_ID/);
  assert.match(device,/safeStorage\.encryptString/);
  assert.match(device,/generateKeyPairSync\("ec"/);
});

test('shared SageBot install is guild locked and requests mention permission',()=>{
  assert.match(service,/url\.searchParams\.set\("guild_id",guildId\)/);
  assert.match(service,/disable_guild_select/);
  assert.match(service,/url\.searchParams\.set\("permissions","199680"\)/);
  assert.match(ui,/Add SageBot to This Server/);
  assert.match(ui,/Copy Install Link/);
  assert.match(ui,/Manage Server/);
});

test('Sage Online reads server channels and roles and enforces its own channel allow-list',()=>{
  assert.match(service,/\/guilds\/\$\{encodeURIComponent\(guildId\)\}\/channels/);
  assert.match(service,/\/guilds\/\$\{encodeURIComponent\(guildId\)\}\/roles/);
  assert.match(service,/Number\(channel\.type\)===0\|\|Number\(channel\.type\)===5/);
  assert.match(backend,/discord_allowed_channels/);
  assert.match(backend,/discord_channel_not_allowed/);
  assert.match(backend,/structure\.sendableChannelIds\.includes\(channelId\)/);
  assert.match(ui,/Where SageBot may talk/);
  assert.match(ui,/Default announcement channel/);
  assert.match(ui,/discord-collapse-card/);
  assert.match(migration7,/CREATE TABLE IF NOT EXISTS discord_allowed_channels/);
});

test('custom leadership announcements use allowed channels and explicit server roles',()=>{
  assert.match(ui,/Send a custom announcement/);
  assert.match(ui,/announcementRoleIds/);
  assert.match(ui,/announcementUserIds/);
  assert.match(ui,/Discord Server Members/);
  assert.match(ui,/Search server members/);
  assert.match(ui,/No role selected = @everyone/);
  assert.match(online,/role_ids:input\.roleIds\?\?\[\]/);
  assert.match(backend,/validateDiscordSendTarget/);
  assert.match(backend,/discordMentionPrefix/);
  assert.match(service,/allowed_mentions:\{parse:mentionEveryone\?\["everyone"\]:\[\],roles:roleIds/);
});

test('operation announcements are generated from authoritative stored operations and direct members to Join Ops',()=>{
  assert.match(planner,/discordNotifyRoleIds/);
  assert.match(planner,/@everyone/);
  assert.match(planner,/announceCorporationOperationDiscord/);
  assert.match(backend,/discordAnnounceOperation/);
  assert.match(backend,/shared_objects so JOIN shared_object_versions/);
  assert.match(backend,/New Eden Sage > Corporation > Join Ops/);
  assert.match(backend,/payload\?\.discordNotifyRoleIds/);
  assert.match(backend,/roleIds\.length===0/);
});

test('personal Discord account can route notifications from chosen owned corporation characters',()=>{
  assert.match(ui,/Characters sending notifications here/);
  assert.match(ui,/updateCorporationDiscordNotificationTargets/);
  assert.match(backend,/discord_notification_targets/);
  assert.match(backend,/notification_character_not_owned/);
  assert.match(backend,/workspace_members WHERE workspace_id=\?1 AND account_id=\?2/);
  assert.match(migration8,/PRIMARY KEY \(workspace_id, account_id, eve_character_id\)/);
  assert.match(service,/discord_notification_targets/);
  const dmStart=service.indexOf('export async function sendDiscordDmToCharacter');
  const dmBody=service.slice(dmStart);
  assert.doesNotMatch(dmBody,/SELECT discord_user_id FROM discord_user_links/);
});

test('Discord writes require device signature plus short-lived single-use payload-bound tickets',()=>{
  assert.match(device,/NES-DISCORD-ACTION-V1/);
  assert.match(device,/dsaEncoding:"ieee-p1363"/);
  assert.match(online,/secureDiscordMutation/);
  assert.match(online,/discord\/action-ticket/);
  assert.match(online,/X-Sage-Action-Ticket/);
  assert.match(security,/ACTION_TICKET_SECONDS=45/);
  assert.match(security,/discord_action_tickets/);
  assert.match(security,/used_at IS NULL/);
  assert.match(security,/discord_action_replay/);
  assert.match(security,/discord_rate_limited/);
  assert.match(migration7,/PRIMARY KEY \(device_id, nonce\)/);
});

test('new notification and operation announcement actions are covered by the signed-command policy',()=>{
  assert.match(security,/discord\.operation_announce/);
  assert.match(security,/discord\.notifications/);
  assert.match(backend,/consumeDiscordActionTicket\(request,env,principal,workspaceId,"discord\.operation_announce"\)/);
  assert.match(backend,/consumeDiscordActionTicket\(request,env,principal,workspaceId,"discord\.notifications"\)/);
});

test('Discord tickets and protected commands bind to exact selected EVE character',()=>{
  assert.match(security,/character_id\?:number/);
  assert.match(security,/eve_character_id/);
  assert.match(security,/X-Sage-Character-ID/);
  assert.match(main,/workspace\.character_id/);
  assert.match(main,/workspace\.can_manage_fleet_ops/);
});

test('OAuth return automatically refreshes linked state and preserves notification routing',()=>{
  assert.match(ui,/window\.addEventListener\("focus",refresh\)/);
  assert.match(ui,/visibilitychange/);
  assert.match(ui,/✓ DISCORD LINKED/);
  assert.match(backend,/discord_oauth_states/);
  assert.match(backend,/UPDATE discord_notification_targets SET discord_user_id/);
});

test('Discord server member targeting is backend validated and kept separate from EVE corporation membership',()=>{
  assert.match(service,/\/guilds\/\$\{encodeURIComponent\(guildId\)\}\/members\?limit=1000/);
  assert.match(service,/membersAvailable:true/);
  assert.match(service,/user\?\.bot/);
  assert.match(service,/allowed_mentions:\{parse:mentionEveryone\?\["everyone"\]:\[\],roles:roleIds,users:userIds/);
  assert.match(planner,/Discord server members/);
  assert.match(planner,/discordNotifyUserIds/);
  assert.match(planner,/op-discord-target-table/);
  assert.match(backend,/discord_members_unavailable/);
  assert.match(backend,/discord_member_unavailable/);
  assert.match(backend,/payload\?\.discordNotifyUserIds/);
  assert.match(backend,/structure\.members\.map\(member=>member\.id\)/);
});

test('Discord state reads retry transient failures and preserve the last good UI state',()=>{
  assert.match(online,/fetchSageOnlineRead/);
  assert.match(online,/attempts=3/);
  assert.match(online,/150\*Math\.pow\(2,attempt\)/);
  assert.match(ui,/Keeping your last good Discord state and draft/);
  assert.doesNotMatch(ui,/catch\(error\)\{setData\(null\);setStructure\(null\)/);
});

test('operation Discord announcements are tracked and removed on cancellation',()=>{
  const migration9=read('backend/migrations/0009_operation_discord_messages.sql');
  assert.match(service,/deleteDiscordChannelMessage/);
  assert.match(service,/findDiscordOperationAnnouncement/);
  assert.match(backend,/operation_discord_messages/);
  assert.match(backend,/message_id:messageId/);
  assert.match(backend,/operation\.discord_delete/);
  assert.match(backend,/operation\.discord_cancel_notice/);
  assert.match(backend,/operationCancellationDiscordContent/);
  assert.match(backend,/cancellation_message:cancellationMessage\|\|null/);
  assert.match(planner,/discordCancellationSent/);
  assert.match(backend,/discord_previous_message_delete_failed/);
  assert.match(backend,/discord_operation_delete_failed/);
  assert.match(online,/discord\.operation_cancel/);
  assert.match(security,/discord\.operation_cancel/);
  assert.match(migration9,/PRIMARY KEY \(workspace_id, object_id\)/);
});

test('operation application notification subscriptions use signed backend commands',()=>{
  assert.match(security,/discord\.operation_notifications/);
  assert.match(backend,/consumeDiscordActionTicket\(request,env,principal,workspaceId,"discord\.operation_notifications"\)/);
  assert.match(online,/discord\.operation_notifications/);
  assert.match(backend,/discord_notifications_not_enabled/);
});
