export const CURRENT_ESI_SCOPE_SCHEMA_VERSION = 1;

export const CORE_READ_SCOPES = [
  "esi-location.read_location.v1",
  "esi-location.read_online.v1",
  "esi-location.read_ship_type.v1",
  "esi-skills.read_skills.v1",
  "esi-skills.read_skillqueue.v1",
  "esi-wallet.read_character_wallet.v1",
] as const;

export const CHARACTER_READ_SCOPES = [
  "esi-assets.read_assets.v1",
  "esi-characters.read_blueprints.v1",
  "esi-characters.read_contacts.v1",
  "esi-characters.read_fatigue.v1",
  "esi-characters.read_loyalty.v1",
  "esi-characters.read_notifications.v1",
  "esi-characters.read_standings.v1",
  "esi-clones.read_clones.v1",
  "esi-clones.read_implants.v1",
  "esi-contracts.read_character_contracts.v1",
  "esi-fittings.read_fittings.v1",
  "esi-industry.read_character_jobs.v1",
  "esi-killmails.read_killmails.v1",
  "esi-mail.read_mail.v1",
  "esi-markets.read_character_orders.v1",
  "esi-characters.read_corporation_roles.v1",
  "esi-characters.read_titles.v1",
  "esi-universe.read_structures.v1",
  "esi-search.search_structures.v1",
] as const;

export const CORPORATION_READ_SCOPES = [
  "esi-corporations.read_corporation_membership.v1",
  "esi-corporations.track_members.v1",
  "esi-corporations.read_titles.v1",
  "esi-corporations.read_divisions.v1",
  "esi-assets.read_corporation_assets.v1",
  "esi-corporations.read_blueprints.v1",
  "esi-corporations.read_contacts.v1",
  "esi-corporations.read_facilities.v1",
  "esi-corporations.read_medals.v1",
  "esi-corporations.read_standings.v1",
  "esi-corporations.read_starbases.v1",
  "esi-corporations.read_structures.v1",
  "esi-contracts.read_corporation_contracts.v1",
  "esi-industry.read_corporation_jobs.v1",
  "esi-markets.read_corporation_orders.v1",
  "esi-wallet.read_corporation_wallets.v1",
] as const;

// These are retained because live Sage features already use them. New durable
// private-data collection must not grow this group casually.
export const EXISTING_ACTION_SCOPES = [
  "esi-planets.manage_planets.v1",
  "esi-fittings.write_fittings.v1",
  "esi-ui.write_waypoint.v1",
  "esi-ui.open_window.v1",
] as const;

export const EVE_SCOPES = [...new Set([
  ...CORE_READ_SCOPES,
  ...CHARACTER_READ_SCOPES,
  ...CORPORATION_READ_SCOPES,
  ...EXISTING_ACTION_SCOPES,
])];

export type PrivateEsiFailureKind =
  | "permission-missing"
  | "role-missing"
  | "rate-limited"
  | "authorization-error"
  | "endpoint-error";

export function requiredScopeForPrivateEsiPath(requestPath: string): string | null {
  const path = requestPath.split("?")[0];
  if (/^\/characters\/\d+\/assets\//.test(path)) return "esi-assets.read_assets.v1";
  if (/^\/characters\/\d+\/blueprints\//.test(path)) return "esi-characters.read_blueprints.v1";
  if (/^\/characters\/\d+\/contacts\//.test(path)) return "esi-characters.read_contacts.v1";
  if (/^\/characters\/\d+\/fatigue\//.test(path)) return "esi-characters.read_fatigue.v1";
  if (/^\/characters\/\d+\/loyalty\/points\//.test(path)) return "esi-characters.read_loyalty.v1";
  if (/^\/characters\/\d+\/notifications\//.test(path)) return "esi-characters.read_notifications.v1";
  if (/^\/characters\/\d+\/standings\//.test(path)) return "esi-characters.read_standings.v1";
  if (/^\/characters\/\d+\/clones\//.test(path)) return "esi-clones.read_clones.v1";
  if (/^\/characters\/\d+\/implants\//.test(path)) return "esi-clones.read_implants.v1";
  if (/^\/characters\/\d+\/contracts(?:\/|$)/.test(path)) return "esi-contracts.read_character_contracts.v1";
  if (/^\/characters\/\d+\/fittings\//.test(path)) return "esi-fittings.read_fittings.v1";
  if (/^\/characters\/\d+\/industry\/jobs\//.test(path)) return "esi-industry.read_character_jobs.v1";
  if (/^\/characters\/\d+\/killmails\/recent\//.test(path)) return "esi-killmails.read_killmails.v1";
  if (/^\/characters\/\d+\/mail(?:\/|$)/.test(path)) return "esi-mail.read_mail.v1";
  if (/^\/characters\/\d+\/location\//.test(path)) return "esi-location.read_location.v1";
  if (/^\/characters\/\d+\/online\//.test(path)) return "esi-location.read_online.v1";
  if (/^\/characters\/\d+\/ship\//.test(path)) return "esi-location.read_ship_type.v1";
  if (/^\/characters\/\d+\/orders\//.test(path)) return "esi-markets.read_character_orders.v1";
  if (/^\/characters\/\d+\/planets(?:\/|$)/.test(path)) return "esi-planets.manage_planets.v1";
  if (/^\/characters\/\d+\/roles\//.test(path)) return "esi-characters.read_corporation_roles.v1";
  if (/^\/characters\/\d+\/skills\//.test(path)) return "esi-skills.read_skills.v1";
  if (/^\/characters\/\d+\/skillqueue\//.test(path)) return "esi-skills.read_skillqueue.v1";
  if (/^\/characters\/\d+\/wallet(?:\/|$)/.test(path)) return "esi-wallet.read_character_wallet.v1";
  if (/^\/universe\/structures\//.test(path)) return "esi-universe.read_structures.v1";

  if (/^\/corporations\/\d+\/membertracking\//.test(path)) return "esi-corporations.track_members.v1";
  if (/^\/corporations\/\d+\/members\/titles\//.test(path) || /^\/corporations\/\d+\/titles\//.test(path)) return "esi-corporations.read_titles.v1";
  if (/^\/corporations\/\d+\/members(?:\/|$)/.test(path)) return "esi-corporations.read_corporation_membership.v1";
  if (/^\/corporations\/\d+\/divisions\//.test(path)) return "esi-corporations.read_divisions.v1";
  if (/^\/corporations\/\d+\/assets(?:\/|$)/.test(path)) return "esi-assets.read_corporation_assets.v1";
  if (/^\/corporations\/\d+\/blueprints\//.test(path)) return "esi-corporations.read_blueprints.v1";
  if (/^\/corporations\/\d+\/contacts\//.test(path)) return "esi-corporations.read_contacts.v1";
  if (/^\/corporations\/\d+\/facilities\//.test(path)) return "esi-corporations.read_facilities.v1";
  if (/^\/corporations\/\d+\/medals\//.test(path)) return "esi-corporations.read_medals.v1";
  if (/^\/corporations\/\d+\/standings\//.test(path)) return "esi-corporations.read_standings.v1";
  if (/^\/corporations\/\d+\/starbases\//.test(path)) return "esi-corporations.read_starbases.v1";
  if (/^\/corporations\/\d+\/structures\//.test(path)) return "esi-corporations.read_structures.v1";
  if (/^\/corporations\/\d+\/contracts(?:\/|$)/.test(path)) return "esi-contracts.read_corporation_contracts.v1";
  if (/^\/corporations\/\d+\/industry\/jobs\//.test(path)) return "esi-industry.read_corporation_jobs.v1";
  if (/^\/corporations\/\d+\/orders\//.test(path)) return "esi-markets.read_corporation_orders.v1";
  if (/^\/corporations\/\d+\/wallets(?:\/|$)/.test(path)) return "esi-wallet.read_corporation_wallets.v1";
  return null;
}

export function datasetIdForPrivateEsiPath(requestPath: string): string {
  const path = requestPath.split("?")[0];
  const rules: Array<[RegExp, string]> = [
    [/^\/characters\/\d+\/mail\/labels\//, "character.mail.labels"],
    [/^\/characters\/\d+\/mail\/lists\//, "character.mail.lists"],
    [/^\/characters\/\d+\/mail\/\d+\//, "character.mail.bodies"],
    [/^\/characters\/\d+\/mail\//, "character.mail.headers"],
    [/^\/characters\/\d+\/wallet\/journal\//, "character.wallet.journal"],
    [/^\/characters\/\d+\/wallet\/transactions\//, "character.wallet.transactions"],
    [/^\/characters\/\d+\/wallet\//, "character.wallet.balance"],
    [/^\/characters\/\d+\/assets\//, "character.assets"],
    [/^\/characters\/\d+\/blueprints\//, "character.blueprints"],
    [/^\/characters\/\d+\/clones\//, "character.clones"],
    [/^\/characters\/\d+\/implants\//, "character.implants"],
    [/^\/characters\/\d+\/contacts\//, "character.contacts"],
    [/^\/characters\/\d+\/fatigue\//, "character.fatigue"],
    [/^\/characters\/\d+\/loyalty\/points\//, "character.loyalty"],
    [/^\/characters\/\d+\/notifications\//, "character.notifications"],
    [/^\/characters\/\d+\/standings\//, "character.standings"],
    [/^\/characters\/\d+\/contracts\/\d+\/items\//, "character.contract.items"],
    [/^\/characters\/\d+\/contracts\//, "character.contracts"],
    [/^\/characters\/\d+\/fittings\//, "character.fittings"],
    [/^\/characters\/\d+\/industry\/jobs\//, "character.industry_jobs"],
    [/^\/characters\/\d+\/killmails\/recent\//, "character.killmails"],
    [/^\/characters\/\d+\/orders\//, "character.market_orders"],
    [/^\/characters\/\d+\/planets\/\d+\//, "character.planet.details"],
    [/^\/characters\/\d+\/planets\//, "character.planets"],
    [/^\/characters\/\d+\/roles\//, "character.roles"],
    [/^\/characters\/\d+\/skills\//, "character.skills"],
    [/^\/characters\/\d+\/skillqueue\//, "character.skillqueue"],
    [/^\/characters\/\d+\/location\//, "character.location"],
    [/^\/characters\/\d+\/ship\//, "character.ship"],
    [/^\/corporations\/\d+\/membertracking\//, "corporation.member_tracking"],
    [/^\/corporations\/\d+\/members\/titles\//, "corporation.member_titles"],
    [/^\/corporations\/\d+\/members\//, "corporation.membership"],
    [/^\/corporations\/\d+\/titles\//, "corporation.titles"],
    [/^\/corporations\/\d+\/divisions\//, "corporation.divisions"],
    [/^\/corporations\/\d+\/assets\//, "corporation.assets"],
    [/^\/corporations\/\d+\/blueprints\//, "corporation.blueprints"],
    [/^\/corporations\/\d+\/contacts\//, "corporation.contacts"],
    [/^\/corporations\/\d+\/facilities\//, "corporation.facilities"],
    [/^\/corporations\/\d+\/medals\//, "corporation.medals"],
    [/^\/corporations\/\d+\/standings\//, "corporation.standings"],
    [/^\/corporations\/\d+\/starbases\//, "corporation.starbases"],
    [/^\/corporations\/\d+\/structures\//, "corporation.structures"],
    [/^\/corporations\/\d+\/contracts\//, "corporation.contracts"],
    [/^\/corporations\/\d+\/industry\/jobs\//, "corporation.jobs"],
    [/^\/corporations\/\d+\/orders\//, "corporation.orders"],
    [/^\/corporations\/\d+\/wallets\/\d+\/journal\//, "corporation.wallet.journal"],
    [/^\/corporations\/\d+\/wallets\/\d+\/transactions\//, "corporation.wallet.transactions"],
    [/^\/corporations\/\d+\/wallets\//, "corporation.wallets"],
  ];
  for (const [pattern, id] of rules) if (pattern.test(path)) return id;
  return path.startsWith("/corporations/") ? "corporation.other" : path.startsWith("/characters/") ? "character.other" : "private.other";
}
