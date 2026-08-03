import crypto from "node:crypto";
import http from "node:http";
import { shell } from "electron";

import { itemCategoryIds, itemVolumes } from "./type-volumes";

export const EVE_SCOPES = [
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
  "esi-location.read_location.v1",
  "esi-location.read_online.v1",
  "esi-location.read_ship_type.v1",
  "esi-markets.read_character_orders.v1",
  "esi-planets.manage_planets.v1",
  "esi-characters.read_corporation_roles.v1",
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
  "esi-skills.read_skills.v1",
  "esi-skills.read_skillqueue.v1",
  "esi-universe.read_structures.v1",
  "esi-wallet.read_character_wallet.v1",
];

const SSO = "https://login.eveonline.com";

function base64url(value: Buffer) {
  return value.toString("base64url");
}

function decodeJwt(token: string) {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("EVE returned an invalid access token.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub: string;
    name: string;
    scp?: string[];
  };
}

export async function loginWithEve(clientId: string, callbackUrl: string) {
  if (!clientId.trim())
    throw new Error("Add the EVE Client ID in Settings first.");
  const callback = new URL(callbackUrl);
  if (callback.hostname !== "localhost" || callback.protocol !== "http:") {
    throw new Error("The desktop callback must use http://localhost.");
  }

  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  const state = base64url(crypto.randomBytes(24));

  const result = new Promise<{
    accessToken: string;
    refreshToken: string;
    characterId: string;
    characterName: string;
  }>((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      try {
        const incoming = new URL(request.url ?? "/", callback.origin);
        if (incoming.pathname !== callback.pathname) {
          response.writeHead(404).end();
          return;
        }
        if (incoming.searchParams.get("state") !== state)
          throw new Error("The EVE login state did not match.");
        const code = incoming.searchParams.get("code");
        if (!code)
          throw new Error(
            incoming.searchParams.get("error_description") ??
              "EVE login was cancelled.",
          );

        const tokenResponse = await fetch(`${SSO}/v2/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            code,
            code_verifier: verifier,
            redirect_uri: callbackUrl,
          }),
        });
        if (!tokenResponse.ok)
          throw new Error(
            `EVE token exchange failed (${tokenResponse.status}).`,
          );
        const tokens = (await tokenResponse.json()) as {
          access_token: string;
          refresh_token: string;
        };
        const claims = decodeJwt(tokens.access_token);
        const characterId = claims.sub.split(":").at(-1);
        if (!characterId) throw new Error("EVE did not return a character ID.");

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(
          "<h2>New Eden Sage is connected.</h2><p>You can close this tab and return to the app.</p>",
        );
        resolve({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          characterId,
          characterName: claims.name,
        });
      } catch (error) {
        response.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end(error instanceof Error ? error.message : "Login failed.");
        reject(error);
      } finally {
        server.close();
      }
    });
    server.on("error", reject);
    server.listen(Number(callback.port), "127.0.0.1");
  });

  const authorize = new URL(`${SSO}/v2/oauth/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    redirect_uri: callbackUrl,
    client_id: clientId,
    scope: EVE_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  await shell.openExternal(authorize.toString());
  return result;
}

export async function refreshEveToken(clientId: string, refreshToken: string) {
  const response = await fetch(`${SSO}/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok)
    throw new Error(`EVE token refresh failed (${response.status}).`);
  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
  };
}

export async function fetchCharacterSnapshot(
  characterId: string,
  accessToken: string,
) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "X-Compatibility-Date": "2026-08-02",
    "X-User-Agent": "NewEdenSage/0.1.0",
  };
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch(`https://esi.evetech.net${path}`, { headers });
    if (!response.ok)
      throw new Error(`ESI request failed (${response.status}) for ${path}.`);
    return response.json() as Promise<T>;
  };
  const capture = async (path: string, paged = false): Promise<unknown> => {
    try {
      const firstPath = paged
        ? `${path}${path.includes("?") ? "&" : "?"}page=1`
        : path;
      const response = await fetch(`https://esi.evetech.net${firstPath}`, {
        headers,
      });
      if (response.status === 204) return null;
      if (!response.ok)
        return { unavailable: true, status: response.status, endpoint: path };
      const first = (await response.json()) as unknown;
      if (!paged || !Array.isArray(first)) return first;
      const pages = Number(response.headers.get("x-pages") ?? 1);
      const rest = await mapLimited(
        Array.from({ length: Math.max(0, pages - 1) }, (_, index) => index + 2),
        6,
        async (page) => {
          const separator = path.includes("?") ? "&" : "?";
          const pageResponse = await fetch(
            `https://esi.evetech.net${path}${separator}page=${page}`,
            { headers },
          );
          if (!pageResponse.ok) return [];
          return pageResponse.json() as Promise<unknown[]>;
        },
      );
      return first.concat(...rest);
    } catch (error) {
      return {
        unavailable: true,
        endpoint: path,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
  const [character, wallet, skills, queue, location, ship, attributes] =
    await Promise.all([
      get<{
        name: string;
        corporation_id: number;
        alliance_id?: number;
        security_status?: number;
      }>(`/characters/${characterId}/`),
      get<number>(`/characters/${characterId}/wallet/`),
      get<{
        total_sp: number;
        unallocated_sp?: number;
        skills: Array<{
          skill_id: number;
          trained_skill_level: number;
          active_skill_level: number;
          skillpoints_in_skill: number;
        }>;
      }>(`/characters/${characterId}/skills/`),
      get<
        Array<{
          skill_id: number;
          finish_date?: string;
          start_date?: string;
          finished_level: number;
          training_start_sp?: number;
          level_end_sp?: number;
        }>
      >(`/characters/${characterId}/skillqueue/`),
      get<{
        solar_system_id: number;
        station_id?: number;
        structure_id?: number;
      }>(`/characters/${characterId}/location/`),
      get<{ ship_item_id: number; ship_name: string; ship_type_id: number }>(
        `/characters/${characterId}/ship/`,
      ),
      get<{
        charisma: number;
        intelligence: number;
        memory: number;
        perception: number;
        willpower: number;
      }>(`/characters/${characterId}/attributes/`),
    ]);

  const publicGet = async <T>(path: string): Promise<T> => {
    const response = await fetch(`https://esi.evetech.net${path}`, {
      headers: {
        "X-Compatibility-Date": "2026-08-02",
        "X-User-Agent": "NewEdenSage/0.1.0",
      },
    });
    if (!response.ok)
      throw new Error(
        `Public ESI request failed (${response.status}) for ${path}.`,
      );
    return response.json() as Promise<T>;
  };
  const [corporation, corporationHistory, solarSystem, shipType, place] =
    await Promise.all([
      publicGet<Record<string, unknown> & { name: string }>(
        `/corporations/${character.corporation_id}/`,
      ),
      publicGet<unknown>(`/characters/${characterId}/corporationhistory/`),
      publicGet<{ name: string }>(
        `/universe/systems/${location.solar_system_id}/`,
      ),
      publicGet<{ name: string }>(`/universe/types/${ship.ship_type_id}/`),
      location.station_id
        ? publicGet<{ name: string }>(
            `/universe/stations/${location.station_id}/`,
          )
        : location.structure_id
          ? get<{ name: string }>(
              `/universe/structures/${location.structure_id}/`,
            )
          : Promise.resolve(null),
    ]);

  const nameResponse = await fetch("https://esi.evetech.net/universe/names/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Compatibility-Date": "2026-08-02",
      "X-User-Agent": "NewEdenSage/0.1.0",
    },
    body: JSON.stringify(skills.skills.map((skill) => skill.skill_id)),
  });
  if (!nameResponse.ok)
    throw new Error(`Skill-name lookup failed (${nameResponse.status}).`);
  const names = (await nameResponse.json()) as Array<{
    id: number;
    name: string;
  }>;
  const nameById = new Map(names.map((item) => [item.id, item.name]));
  const skillDetails = await mapLimited(skills.skills, 10, async (skill) => {
    const type = await publicGet<{
      dogma_attributes?: Array<{ attribute_id: number; value: number }>;
    }>(`/universe/types/${skill.skill_id}/`);
    const dogma = new Map(
      (type.dogma_attributes ?? []).map((item) => [
        item.attribute_id,
        item.value,
      ]),
    );
    return {
      ...skill,
      name: nameById.get(skill.skill_id) ?? `Skill ${skill.skill_id}`,
      rank: dogma.get(275) ?? 1,
      primaryAttributeId: dogma.get(180),
      secondaryAttributeId: dogma.get(181),
    };
  });
  const detailedSkills = skillDetails
    .map((skill) => ({
      ...skill,
      timeToLevels: calculateTrainingTimes(
        skill,
        attributes,
        queue.filter((item) => item.skill_id === skill.skill_id),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const [
    assets,
    blueprints,
    clones,
    implants,
    contacts,
    fatigue,
    loyaltyPoints,
    notifications,
    standings,
    contracts,
    fittings,
    industryJobs,
    killmails,
    marketOrders,
    walletJournal,
    walletTransactions,
    planets,
    corporationRoles,
    corporationAssets,
    corporationBlueprints,
    corporationContacts,
    corporationFacilities,
    corporationMedals,
    corporationStandings,
    corporationStarbases,
    corporationStructures,
    corporationContracts,
    corporationIndustryJobs,
    corporationMarketOrders,
    corporationWallets,
  ] = await Promise.all([
    capture(`/characters/${characterId}/assets/`, true),
    capture(`/characters/${characterId}/blueprints/`, true),
    capture(`/characters/${characterId}/clones/`),
    capture(`/characters/${characterId}/implants/`),
    capture(`/characters/${characterId}/contacts/`, true),
    capture(`/characters/${characterId}/fatigue/`),
    capture(`/characters/${characterId}/loyalty/points/`),
    capture(`/characters/${characterId}/notifications/`),
    capture(`/characters/${characterId}/standings/`),
    capture(`/characters/${characterId}/contracts/`, true),
    capture(`/characters/${characterId}/fittings/`),
    capture(
      `/characters/${characterId}/industry/jobs/?include_completed=true`,
      true,
    ),
    capture(`/characters/${characterId}/killmails/recent/`, true),
    capture(`/characters/${characterId}/orders/?include_historical=true`, true),
    capture(`/characters/${characterId}/wallet/journal/`, true),
    capture(`/characters/${characterId}/wallet/transactions/`, true),
    capture(`/characters/${characterId}/planets/`),
    capture(`/characters/${characterId}/roles/`),
    capture(`/corporations/${character.corporation_id}/assets/`, true),
    capture(`/corporations/${character.corporation_id}/blueprints/`, true),
    capture(`/corporations/${character.corporation_id}/contacts/`, true),
    capture(`/corporations/${character.corporation_id}/facilities/`),
    capture(`/corporations/${character.corporation_id}/medals/`, true),
    capture(`/corporations/${character.corporation_id}/standings/`, true),
    capture(`/corporations/${character.corporation_id}/starbases/`, true),
    capture(`/corporations/${character.corporation_id}/structures/`, true),
    capture(`/corporations/${character.corporation_id}/contracts/`, true),
    capture(
      `/corporations/${character.corporation_id}/industry/jobs/?include_completed=true`,
      true,
    ),
    capture(`/corporations/${character.corporation_id}/orders/`, true),
    capture(`/corporations/${character.corporation_id}/wallets/`),
  ]);
  const contractItems = Array.isArray(contracts)
    ? await mapLimited(
        contracts as Array<{ contract_id: number }>,
        6,
        async (contract) => ({
          contractId: contract.contract_id,
          items: await capture(
            `/characters/${characterId}/contracts/${contract.contract_id}/items/`,
            true,
          ),
        }),
      )
    : contracts;
  const planetDetails = Array.isArray(planets)
    ? await mapLimited(
        planets as Array<{ planet_id: number }>,
        6,
        async (planet) => ({
          planetId: planet.planet_id,
          colony: await capture(
            `/characters/${characterId}/planets/${planet.planet_id}/`,
          ),
        }),
      )
    : planets;
  const killmailDetails = Array.isArray(killmails)
    ? await mapLimited(
        killmails as Array<{ killmail_id: number; killmail_hash: string }>,
        8,
        async (killmail) => ({
          ...killmail,
          detail: await capture(
            `/killmails/${killmail.killmail_id}/${killmail.killmail_hash}/`,
          ),
        }),
      )
    : killmails;
  const currentShipFit = Array.isArray(assets)
    ? (
        assets as Array<{
          location_id: number;
          location_flag: string;
          type_id: number;
          item_id: number;
          quantity: number;
        }>
      ).filter(
        (asset) =>
          asset.location_id === ship.ship_item_id ||
          asset.item_id === ship.ship_item_id,
      )
    : assets;
  const corporationWalletHistory = Array.isArray(corporationWallets)
    ? await mapLimited(
        corporationWallets as Array<{ division: number }>,
        4,
        async (division) => ({
          division: division.division,
          journal: await capture(
            `/corporations/${character.corporation_id}/wallets/${division.division}/journal/`,
            true,
          ),
          transactions: await capture(
            `/corporations/${character.corporation_id}/wallets/${division.division}/transactions/`,
            true,
          ),
        }),
      )
    : corporationWallets;

  const enrichedAssets = Array.isArray(assets)
    ? await enrichAssets(assets as AssetRecord[], headers)
    : assets;
  const assetSummary = Array.isArray(enrichedAssets)
    ? summarizeAssets(enrichedAssets)
    : null;
  const enrichedCurrentShipFit = Array.isArray(enrichedAssets)
    ? enrichedAssets.filter(
        (asset) =>
          asset.location_id === ship.ship_item_id ||
          asset.item_id === ship.ship_item_id,
      )
    : currentShipFit;
  const enrichedImplants = Array.isArray(implants)
    ? await (async () => {
        const implantIds = implants.filter(
          (item): item is number => typeof item === "number",
        );
        if (!implantIds.length) return [];
        try {
          const response = await fetch(
            "https://esi.evetech.net/universe/names/",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Compatibility-Date": "2026-08-02",
                "X-User-Agent": "NewEdenSage/0.1.0",
              },
              body: JSON.stringify(implantIds),
            },
          );
          if (!response.ok) return implantIds;
          const resolved = (await response.json()) as Array<{
            id: number;
            name: string;
          }>;
          const names = new Map(resolved.map((item) => [item.id, item.name]));
          return implantIds.map((typeId) => ({
            typeId,
            name: names.get(typeId) ?? `Implant ${typeId}`,
          }));
        } catch {
          return implantIds;
        }
      })()
    : implants;

  return {
    characterId,
    character: {
      ...character,
      corporation_name: corporation.name,
      corporation_data: corporation,
      corporation_history: corporationHistory,
    },
    wallet,
    skills: { ...skills, skills: detailedSkills },
    queue,
    attributes,
    location: {
      ...location,
      solar_system_name: solarSystem.name,
      place_name: place?.name ?? solarSystem.name,
    },
    ship: { ...ship, ship_type_name: shipType.name },
    extended: {
      assets: enrichedAssets,
      assetSummary,
      blueprints,
      clones,
      implants: enrichedImplants,
      contacts,
      fatigue,
      loyaltyPoints,
      notifications,
      standings,
      contracts,
      contractItems,
      fittings,
      industryJobs,
      killmails,
      killmailDetails,
      marketOrders,
      walletJournal,
      walletTransactions,
      walletHistorySummary: {
        journal: captureStatus(walletJournal),
        transactions: captureStatus(walletTransactions),
        note: "ESI supplies recent wallet history only. An unavailable 403 status means the character must be reconnected with current wallet scopes.",
      },
      planets,
      planetDetails,
      currentShipFit: enrichedCurrentShipFit,
      corporation: {
        publicData: corporation,
        history: corporationHistory,
        roles: corporationRoles,
        assets: corporationAssets,
        blueprints: corporationBlueprints,
        contacts: corporationContacts,
        facilities: corporationFacilities,
        medals: corporationMedals,
        standings: corporationStandings,
        starbases: corporationStarbases,
        structures: corporationStructures,
        contracts: corporationContracts,
        industryJobs: corporationIndustryJobs,
        marketOrders: corporationMarketOrders,
        wallets: corporationWallets,
        walletHistory: corporationWalletHistory,
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

type AssetRecord = {
  is_singleton?: boolean;
  item_id: number;
  location_flag: string;
  location_id: number;
  location_type: "station" | "solar_system" | "item" | "other";
  quantity: number;
  type_id: number;
};

async function enrichAssets(
  assets: AssetRecord[],
  headers: Record<string, string>,
) {
  const postNames = async (ids: number[]) => {
    if (!ids.length) return [];
    const response = await fetch("https://esi.evetech.net/universe/names/", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(ids),
    });
    if (!response.ok) return [];
    return response.json() as Promise<Array<{ id: number; name: string }>>;
  };
  const typeIds = [...new Set(assets.map((asset) => asset.type_id))];
  const typeNames = (
    await mapLimited(chunk(typeIds, 1000), 4, postNames)
  ).flat();
  const typeNameById = new Map(typeNames.map((item) => [item.id, item.name]));
  const volumes = await itemVolumes(typeIds);
  const categoryIds = await itemCategoryIds(typeIds);
  const priceResponse = await fetch("https://esi.evetech.net/markets/prices/", {
    headers,
  });
  const prices = priceResponse.ok
    ? ((await priceResponse.json()) as Array<{
        type_id: number;
        average_price?: number;
        adjusted_price?: number;
      }>)
    : [];
  const priceByType = new Map(
    prices.map((price) => [
      price.type_id,
      price.average_price ?? price.adjusted_price ?? 0,
    ]),
  );
  const assetById = new Map(assets.map((asset) => [asset.item_id, asset]));
  const rootLocation = (asset: AssetRecord) => {
    let current = asset;
    const visited = new Set<number>();
    while (current.location_type === "item" && !visited.has(current.item_id)) {
      visited.add(current.item_id);
      const parent = assetById.get(current.location_id);
      if (!parent) break;
      current = parent;
    }
    return {
      id: current.location_id,
      type: current.location_type,
    };
  };
  const roots = [
    ...new Map(
      assets.map((asset) => {
        const root = rootLocation(asset);
        return [`${root.type}:${root.id}`, root] as const;
      }),
    ).values(),
  ];
  const resolvedRoots = await mapLimited(roots, 12, async (root) => {
    try {
      if (root.type === "station") {
        const stationResponse = await fetch(
          `https://esi.evetech.net/universe/stations/${root.id}/`,
          { headers },
        );
        if (!stationResponse.ok) throw new Error("station unavailable");
        const station = (await stationResponse.json()) as {
          name: string;
          system_id: number;
        };
        const systemResponse = await fetch(
          `https://esi.evetech.net/universe/systems/${station.system_id}/`,
          { headers },
        );
        const system = systemResponse.ok
          ? ((await systemResponse.json()) as { name: string })
          : null;
        return {
          key: `${root.type}:${root.id}`,
          station: station.name,
          system: system?.name ?? `System ${station.system_id}`,
          systemId: station.system_id,
        };
      }
      if (root.type === "solar_system") {
        const response = await fetch(
          `https://esi.evetech.net/universe/systems/${root.id}/`,
          { headers },
        );
        const system = response.ok
          ? ((await response.json()) as { name: string })
          : null;
        return {
          key: `${root.type}:${root.id}`,
          station: null,
          system: system?.name ?? `System ${root.id}`,
          systemId: root.id,
        };
      }
      if (root.id > 1_000_000_000_000) {
        const response = await fetch(
          `https://esi.evetech.net/universe/structures/${root.id}/`,
          { headers },
        );
        if (response.ok) {
          const structure = (await response.json()) as {
            name: string;
            solar_system_id: number;
          };
          const systemResponse = await fetch(
            `https://esi.evetech.net/universe/systems/${structure.solar_system_id}/`,
            { headers },
          );
          const system = systemResponse.ok
            ? ((await systemResponse.json()) as { name: string })
            : null;
          return {
            key: `${root.type}:${root.id}`,
            station: structure.name,
            system: system?.name ?? `System ${structure.solar_system_id}`,
            systemId: structure.solar_system_id,
          };
        }
      }
    } catch {
      /* Preserve the raw location below when ESI cannot resolve it. */
    }
    return {
      key: `${root.type}:${root.id}`,
      station: null,
      system: null,
      systemId: null,
    };
  });
  const rootByKey = new Map(resolvedRoots.map((root) => [root.key, root]));
  return assets.map((asset) => {
    const root = rootLocation(asset);
    const resolved = rootByKey.get(`${root.type}:${root.id}`);
    const itemVolumeM3 = volumes.get(asset.type_id) ?? 0;
    const estimatedUnitValue = priceByType.get(asset.type_id) ?? 0;
    const quantity = asset.quantity > 0 ? asset.quantity : 1;
    return {
      ...asset,
      item: typeNameById.get(asset.type_id) ?? `Type ${asset.type_id}`,
      category_id: categoryIds.get(asset.type_id) ?? 0,
      station: resolved?.station ?? null,
      system: resolved?.system ?? null,
      system_id: resolved?.systemId ?? null,
      root_location_id: root.id,
      container_item_id:
        asset.location_type === "item" ? asset.location_id : null,
      item_volume_m3: itemVolumeM3,
      total_volume_m3: itemVolumeM3 * quantity,
      estimated_unit_value: estimatedUnitValue,
      estimatedValue: estimatedUnitValue * quantity,
    };
  });
}

function summarizeAssets(
  assets: Array<{
    item: string;
    category_id: number;
    station: string | null;
    system: string | null;
    quantity: number;
    estimatedValue: number;
    item_volume_m3: number;
    total_volume_m3: number;
    type_id: number;
    item_id: number;
  }>,
) {
  const categoryNames: Record<number, string> = {
    6: "Ships",
    7: "Modules",
    8: "Ammo",
    9: "Blueprints",
    16: "Skillbooks",
  };
  const byCategory: Record<string, number> = {
    Ships: 0,
    Modules: 0,
    Ammo: 0,
    Blueprints: 0,
    Skillbooks: 0,
    Misc: 0,
  };
  const stationTotals = new Map<
    string,
    {
      station: string;
      system: string | null;
      estimatedValue: number;
      items: number;
    }
  >();
  const ownedShips = [];
  for (const asset of assets) {
    const category = categoryNames[asset.category_id] ?? "Misc";
    byCategory[category] += asset.estimatedValue;
    const station = asset.station ?? asset.system ?? "Unresolved location";
    const stationTotal = stationTotals.get(station) ?? {
      station,
      system: asset.system,
      estimatedValue: 0,
      items: 0,
    };
    stationTotal.estimatedValue += asset.estimatedValue;
    stationTotal.items += asset.quantity > 0 ? asset.quantity : 1;
    stationTotals.set(station, stationTotal);
    if (asset.category_id === 6)
      ownedShips.push({
        item: asset.item,
        station: asset.station,
        system: asset.system,
        quantity: asset.quantity > 0 ? asset.quantity : 1,
        estimatedValue: asset.estimatedValue,
        item_volume_m3: asset.item_volume_m3,
        total_volume_m3: asset.total_volume_m3,
        type_id: asset.type_id,
        item_id: asset.item_id,
      });
  }
  return {
    valuation_basis:
      "ESI average market price, falling back to adjusted price; estimates are not guaranteed sale values.",
    byCategory,
    totalAssetValue: Object.values(byCategory).reduce(
      (total, value) => total + value,
      0,
    ),
    assetsByStation: [...stationTotals.values()].sort(
      (a, b) => b.estimatedValue - a.estimatedValue,
    ),
    ownedShips: ownedShips.sort((a, b) => a.item.localeCompare(b.item)),
  };
}

function captureStatus(value: unknown) {
  if (Array.isArray(value))
    return {
      status: "captured",
      records: value.length,
      empty: value.length === 0,
    };
  if (value && typeof value === "object") {
    const detail = value as Record<string, unknown>;
    if (detail.unavailable)
      return {
        status: "unavailable",
        esiStatus: detail.status ?? null,
        endpoint: detail.endpoint ?? null,
        error: detail.error ?? null,
      };
  }
  return { status: value == null ? "no data" : "captured" };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await mapper(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

const ATTRIBUTE_NAMES: Record<
  number,
  "charisma" | "intelligence" | "memory" | "perception" | "willpower"
> = {
  164: "charisma",
  165: "intelligence",
  166: "memory",
  167: "perception",
  168: "willpower",
};
const BASE_SKILL_POINTS = [0, 250, 1415, 8000, 45255, 256000];

function calculateTrainingTimes(
  skill: {
    trained_skill_level: number;
    skillpoints_in_skill: number;
    rank: number;
    primaryAttributeId?: number;
    secondaryAttributeId?: number;
  },
  attributes: {
    charisma: number;
    intelligence: number;
    memory: number;
    perception: number;
    willpower: number;
  },
  queue: Array<{ finished_level: number; finish_date?: string }>,
) {
  const primary = skill.primaryAttributeId
    ? attributes[ATTRIBUTE_NAMES[skill.primaryAttributeId]]
    : undefined;
  const secondary = skill.secondaryAttributeId
    ? attributes[ATTRIBUTE_NAMES[skill.secondaryAttributeId]]
    : undefined;
  const spPerMinute = primary && secondary ? primary + secondary / 2 : 0;
  return [1, 2, 3, 4, 5]
    .filter((level) => level > skill.trained_skill_level)
    .map((level) => {
      const queued = queue.find(
        (item) => item.finished_level === level,
      )?.finish_date;
      const remainingSp = Math.max(
        0,
        BASE_SKILL_POINTS[level] * skill.rank - skill.skillpoints_in_skill,
      );
      return {
        level,
        seconds: spPerMinute
          ? Math.ceil((remainingSp / spPerMinute) * 60)
          : null,
        queuedFinishDate: queued,
      };
    });
}
