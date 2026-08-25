const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');
const backend=read('backend/src/index.ts');
const migration=read('backend/migrations/0006_operation_authority_roles_and_titles.sql');
const planner=read('src/CorporationOpPlanner.tsx');
const rolesUi=read('src/CorporationRoles.tsx');
const fitPreview=read('src/OperationFitPreview.tsx');
const eve=read('electron/eve.ts');
const mainTask9=read('electron/main-task9.ts');

const defaultRoleKeys=['Personnel_Manager','Communications_Officer','Starbase_Defense_Operator','Skill_Plan_Manager'];

test('operation creator defaults are the four requested EVE roles',()=>{
  for(const role of defaultRoleKeys){
    assert.match(backend,new RegExp(role));
    assert.match(migration,new RegExp(role));
  }
  const definitionStart=backend.indexOf('const DEFAULT_OPERATION_AUTHORITY_ROLES');
  const definitionEnd=backend.indexOf('const CORPORATION_PERMISSION_DEFINITIONS',definitionStart);
  const block=backend.slice(definitionStart,definitionEnd);
  assert.doesNotMatch(block,/Fitting_Manager|Director/);
});

test('operation publishing remains backend-authorized',()=>{
  assert.match(backend,/const actorCharacterId = Number\(request\.headers\.get\("X-Sage-Character-ID"\) \?\? 0\)/);
  assert.match(backend,/const canPublish = await hasPermission\(env, workspaceId, principal\.accountId, publishPermissionFor\(objectType\), objectType === "sage\.operation" \? actorCharacterId : undefined\)/);
  assert.doesNotMatch(backend,/TESTING: any active corporation workspace member may create/);
});

test('CEO and Director are policy administrators without being forced into the selectable rule set',()=>{
  assert.match(backend,/const isCeo = characterId > 0 && corporationCeoId === characterId/);
  assert.match(backend,/const isDirector = roles\.has\("Director"\)/);
  assert.match(backend,/if \(!administrator\.canConfigure\) return error\(403/);
  assert.match(rolesUi,/CEO & Directors/);
  assert.match(rolesUi,/cannot lock itself out/);
  assert.doesNotMatch(backend,/requested\.includes\("Director"\)/);
  assert.doesNotMatch(rolesUi,/active\.add\("Director"\)/);
});

test('corp authority accepts arbitrary mixes of EVE roles and corporation titles',()=>{
  assert.match(backend,/type CorporationAuthorityType = "eve_role" \| "eve_title"/);
  assert.match(backend,/selected_authorities/);
  assert.match(backend,/authority_type IN \('eve_role','eve_title'\)/);
  assert.match(rolesUi,/Exact EVE role key/);
  assert.match(rolesUi,/Exact corporation title/);
  assert.match(rolesUi,/authorities:selected\[permission\.key\]/);
  assert.match(rolesUi,/corp-authority-structure-grid/);
});

test('title-capable ESI scopes are requested for the role editor',()=>{
  assert.match(eve,/esi-characters\.read_titles\.v1/);
  assert.match(eve,/esi-corporations\.read_titles\.v1/);
});

test('operation creator can disable fit review or disable approval entirely',()=>{
  assert.match(planner,/Require leadership approval/);
  assert.match(planner,/Require fit review/);
  assert.match(planner,/approvalRequired===false/);
  assert.match(backend,/const automaticApproval = payload\?\.approvalRequired === false/);
  assert.match(backend,/status: automaticApproval \? "approved" : "pending"/);
  assert.match(backend,/payload\?\.approvalRequired !== false && payload\?\.fitCheckEnabled/);
});

test('turning approval off promotes existing pending applications during edit',()=>{
  assert.match(planner,/app\.status==="pending"\?\{\.\.\.app,status:"approved" as const/);
  assert.match(planner,/Pending and future role requests are auto-approved/);
});

test('approval message input does not remount after every keystroke',()=>{
  assert.match(planner,/mode==="command"\?CommandView\(\):JoinView\(\)/);
  assert.match(planner,/if\(editor\)return Editor\(\)/);
  assert.doesNotMatch(planner,/<CommandView\/>|<JoinView\/>|<Editor\/>/);
});

test('approval queue uses the fit preview instead of printing raw fitting JSON',()=>{
  assert.match(planner,/OperationFitPreview/);
  assert.match(planner,/View fit/);
  assert.doesNotMatch(planner,/<pre>\{app\.fitText\}<\/pre>/);
  assert.match(fitPreview,/Sage JSON/);
  assert.match(fitPreview,/EFT \/ PYFA/);
  assert.match(fitPreview,/ESI JSON/);
  assert.match(fitPreview,/DNA/);
});

test('verified member join/apply path remains broad and creator is not excluded',()=>{
  const applyStart=backend.indexOf('async function applyForOperationRole');
  const decideStart=backend.indexOf('async function decideOperationApplication');
  const applyBody=backend.slice(applyStart,decideStart);
  assert.match(applyBody,/membership_state = 'active'/);
  assert.doesNotMatch(applyBody,/fleet\.manage|fleet\.approve|createdBy/);
  assert.match(planner,/>Command Ops</);
  assert.match(planner,/>Join Ops</);
  assert.match(planner,/You created this operation\. You can still request any available role like every other member\./);
});

test('corporation context remains strictly bound to the selected EVE character',()=>{
  const start=mainTask9.indexOf('async function planetaryCorporationContext');
  const end=mainTask9.indexOf('async function sageOnlineSessionTokenOnly',start);
  const body=mainTask9.slice(start,end);
  assert.ok(start>=0&&end>start,'planetaryCorporationContext should exist');
  assert.doesNotMatch(body,/config\.primaryCharacterId/);
  assert.match(body,/const requested = String\(characterId \?\? ""\)\.trim\(\)/);
  assert.match(body,/const refreshEncrypted = config\.encryptedRefreshTokens\[requested\]/);
});


test('operation Discord announcements default to everyone but may target live server roles',()=>{
  assert.match(planner,/discordAnnouncementEnabled/);
  assert.match(planner,/discordNotifyRoleIds/);
  assert.match(planner,/getCorporationDiscordServerStructure/);
  assert.match(planner,/@everyone/);
  assert.match(planner,/announceCorporationOperationDiscord/);
  assert.match(backend,/discordAnnounceOperation/);
  assert.match(backend,/New Eden Sage > Corporation > Join Ops/);
});


test('cancelled operations are terminal, visible and reject new participation',()=>{
  assert.match(planner,/Cancel Operation/);
  assert.match(planner,/Cancellation message/);
  assert.match(planner,/cancelCorporationOperation/);
  assert.match(planner,/rows\.filter\(row=>row\.payload\.status!=="cancelled"\)/);
  assert.match(planner,/setOps\(current=>current\.filter\(op=>op\.summary\.id!==cancelledId\)\)/);
  assert.match(planner,/OPERATION CANCELLED/);
  assert.match(planner,/payload\.status==="cancelled"\?"Operation Cancelled"/);
  assert.match(backend,/operation_cancelled_terminal/);
  assert.match(backend,/operation_cancel_endpoint_required/);
  assert.match(backend,/currentPayload\?\.status==="cancelled"/);
  assert.match(backend,/app\?\.status==="pending"\?\{\.\.\.app,status:"denied"/);
  assert.match(backend,/no longer accepting role requests/);
});

test('operation ownership and multi-leader role-request notifications are backend controlled',()=>{
  assert.match(planner,/Take Ownership/);
  assert.match(planner,/Add me to notifications/);
  assert.match(planner,/notificationLeaderCharacterIds/);
  assert.match(backend,/takeOperationOwnership/);
  assert.match(backend,/setOperationApplicationNotifications/);
  assert.match(backend,/operationOwner: actor/);
  assert.match(backend,/nextPayload\.operationOwner = currentPayload\?\.operationOwner/);
  assert.match(backend,/notifyOperationLeadersOfApplication/);
  assert.match(backend,/operation_application_active/);
  assert.match(backend,/hasPermission\(env,workspaceId,membership\.account_id,"fleet\.manage",characterId\)/);
  assert.match(backend,/sendDiscordDmToCharacter\(env,workspaceId,characterId,content\)/);
});
