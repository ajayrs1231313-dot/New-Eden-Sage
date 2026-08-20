import { getNavigationPveHazards } from "./pve-location-intelligence";

export type NavigationHazardProviderId = "incursion" | "triglavian" | "edencom";

export type NavigationHazardProviderSnapshot = {
  id: NavigationHazardProviderId;
  label: string;
  available: boolean;
  systemIds: number[];
  fetchedAt?: string;
  note: string;
};

export type NavigationHazardSnapshot = {
  fetchedAt: string;
  providers: NavigationHazardProviderSnapshot[];
};

type HazardProvider = {
  id: NavigationHazardProviderId;
  label: string;
  load: (force: boolean) => Promise<Omit<NavigationHazardProviderSnapshot, "id" | "label">>;
};

const providers: HazardProvider[] = [
  {
    id: "incursion",
    label: "Incursion systems",
    load: async (force) => {
      const live = await getNavigationPveHazards(force);
      return {
        available: true,
        systemIds: live.incursionSystemIds,
        fetchedAt: live.fetchedAt,
        note: live.incursionSystemIds.length
          ? `${live.incursionSystemIds.length} systems are currently listed inside live incursions by CCP ESI.`
          : "CCP ESI currently lists no active incursion systems.",
      };
    },
  },
  {
    id: "triglavian",
    label: "Triglavian special-state systems",
    load: async () => ({
      available: false,
      systemIds: [],
      note: "No trustworthy current Triglavian route-exclusion provider is wired into Sage yet. This toggle stays inert rather than guessing system state.",
    }),
  },
  {
    id: "edencom",
    label: "EDENCOM special-state systems",
    load: async () => ({
      available: false,
      systemIds: [],
      note: "No trustworthy current EDENCOM route-exclusion provider is wired into Sage yet. This toggle stays inert rather than guessing system state.",
    }),
  },
];

export async function getNavigationHazardSnapshot(force = false): Promise<NavigationHazardSnapshot> {
  const snapshots = await Promise.all(providers.map(async (provider) => {
    try {
      const result = await provider.load(force);
      return { id: provider.id, label: provider.label, ...result };
    } catch (error) {
      return {
        id: provider.id,
        label: provider.label,
        available: false,
        systemIds: [],
        note: error instanceof Error ? error.message : "Hazard provider failed.",
      } satisfies NavigationHazardProviderSnapshot;
    }
  }));
  const newest = snapshots.reduce((value, provider) => {
    const time = provider.fetchedAt ? Date.parse(provider.fetchedAt) : 0;
    return time > value ? time : value;
  }, 0);
  return {
    fetchedAt: newest ? new Date(newest).toISOString() : new Date().toISOString(),
    providers: snapshots,
  };
}
