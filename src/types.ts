export interface PublicConfig {
  eveClientId: string;
  callbackUrl: string;
  connectedCharacterIds: string[];
}

export interface CharacterSnapshot {
  characterId: string;
  character: {
    name: string;
    corporation_id: number;
    corporation_name: string;
    alliance_id?: number;
    security_status?: number;
  };
  wallet: number;
  skills: { total_sp: number; unallocated_sp?: number; skills: SkillDetail[] };
  queue: Array<{
    skill_id: number;
    finish_date?: string;
    finished_level: number;
  }>;
  location: {
    solar_system_id: number;
    solar_system_name: string;
    place_name: string;
    station_id?: number;
    structure_id?: number;
  };
  ship: {
    ship_item_id: number;
    ship_name: string;
    ship_type_id: number;
    ship_type_name: string;
  };
  updatedAt: string;
  extended?: {
    implants?: Array<number | { typeId: number; name: string }>;
    assetSummary?: {
      ownedShips?: Array<{ item: string; quantity: number }>;
    };
  };
}

export interface SkillDetail {
  skill_id: number;
  name: string;
  trained_skill_level: number;
  active_skill_level: number;
  skillpoints_in_skill: number;
  rank: number;
  timeToLevels: Array<{
    level: number;
    seconds: number | null;
    queuedFinishDate?: string;
  }>;
}

export interface MarketSummary {
  regionId: number;
  regionName: string;
  orderCount: number;
  pageCount: number;
  buyOrders: number;
  sellOrders: number;
  uniqueTypes: number;
  remainingUnits: number;
  updatedAt: string;
  items?: MarketItem[];
  topOrders: Array<{
    order_id: number;
    is_buy_order: boolean;
    price: number;
    volume_remain: number;
    typeName: string;
    totalValue: number;
  }>;
}

export interface RetainedMarketOrder {
  orderId: number;
  price: number;
  volumeRemain: number;
  locationId: number;
  locationName: string;
  systemId: number;
  systemName: string;
  issued: string;
  minVolume?: number;
  range?: string;
  durationDays?: number;
}
export interface MarketItem {
  typeId: number;
  typeName: string;
  categoryId?: number;
  categoryName?: string;
  itemVolumeM3?: number;
  estimatedUnitValue?: number;
  buyOrderCount: number;
  sellOrderCount: number;
  buyVolume: number;
  sellVolume: number;
  bestBuy: number | null;
  bestSell: number | null;
  spreadPercent: number | null;
  topBuyOrders?: RetainedMarketOrder[];
  topSellOrders?: RetainedMarketOrder[];
  omittedBuyOrders?: number;
  omittedSellOrders?: number;
}

declare global {
  interface Window {
    sage: {
      copyText(value: string): Promise<boolean>;
      resolveTypeNames(
        names: string[],
      ): Promise<Array<{ id: number; name: string }>>;
      resolveTypeIds(ids: number[]): Promise<Array<{ id: number; name: string }>>;
      listShips(): Promise<Array<{ typeId: number; name: string }>>;
      analyzeFitting(input: {
        characterId: string;
        hullTypeId?: number;
        itemTypeIds: number[];
      }): Promise<any>;
      getConfig(): Promise<PublicConfig>;
      saveConfig(input: { eveClientId: string }): Promise<PublicConfig>;
      loginWithEve(): Promise<{
        characterId: string;
        characterName: string;
        snapshot: CharacterSnapshot;
      }>;
      refreshCharacter(characterId: string): Promise<CharacterSnapshot>;
      listSnapshots(): Promise<CharacterSnapshot[]>;
      removeCharacter(characterId: string): Promise<CharacterSnapshot[]>;
      exportData(
        format: "json" | "chatgpt" | "chatgpt-radius",
        characterId?: string,
      ): Promise<string | null>;
      importData(): Promise<{
        snapshots: number;
        information: number;
        files: number;
      } | null>;
      exportDebugLog(): Promise<string | null>;
      listMarketRegions(): Promise<Array<{ regionId: number; name: string }>>;
      buildFitShoppingRoute(input: {
        characterId: string;
        buyEntireFit: boolean;
        items: Array<{ typeId?: number; name: string; quantity: number }>;
      }): Promise<any>;
      findRadiusTrades(
        mode:
          | "top"
          | "top1000"
          | "widened"
          | "likely"
          | "capital"
          | "under10"
          | "wallet100m"
          | "viator"
          | "iskm3",
      ): Promise<any>;
      exportTopArbitrage(): Promise<string | null>;
      listMarketSummaries(): Promise<MarketSummary[]>;
      getMarketRegion(regionId: number): Promise<MarketSummary | null>;
      getMarketStorage(): Promise<{ path: string; retainedDatasets: number }>;
      pullMarket(input: {
        mode: "single" | "all" | "radius" | "contracts";
        regionId?: number;
        characterId?: string;
        includeLowSec?: boolean;
      }): Promise<{
        summaries: MarketSummary[];
        storage: { path: string; retained: number };
      }>;
      onMarketProgress(
        callback: (progress: {
          mode: "single" | "all" | "radius" | "contracts";
          regionName: string;
          regionsDone: number;
          regionsTotal: number;
          pagesDone: number;
          pagesTotal: number;
        }) => void,
      ): () => void;
    };
  }
}
