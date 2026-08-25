import { availableParallelism, freemem, totalmem } from "node:os";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export type SyncMemorySnapshot = {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  arrayBuffersMb: number;
  freeSystemMb: number;
  totalSystemMb: number;
};

export function getSyncMemorySnapshot(): SyncMemorySnapshot {
  const memory = process.memoryUsage();
  const mb = (value: number) => Math.round(value / MB);
  return {
    rssMb: mb(memory.rss),
    heapUsedMb: mb(memory.heapUsed),
    heapTotalMb: mb(memory.heapTotal),
    externalMb: mb(memory.external),
    arrayBuffersMb: mb(memory.arrayBuffers),
    freeSystemMb: mb(freemem()),
    totalSystemMb: mb(totalmem()),
  };
}

export function syncMemoryLimits(totalSystemMb: number) {
  return {
    minFreeSystemMb: Math.max(1_536, Math.min(3_072, Math.round(totalSystemMb * 0.20))),
    maxMainRssMb: Math.max(1_536, Math.min(2_560, Math.round(totalSystemMb * 0.16))),
  };
}

export function syncMemoryHeadroom(sample: SyncMemorySnapshot) {
  const limits = syncMemoryLimits(sample.totalSystemMb);
  return {
    ok: sample.freeSystemMb >= limits.minFreeSystemMb && sample.rssMb <= limits.maxMainRssMb,
    sample,
    ...limits,
  };
}

export function recommendedMarketDownloadWorkers(cpuCount = availableParallelism(), totalMemoryBytes = totalmem()) {
  if (cpuCount >= 6 && totalMemoryBytes >= 12 * GB) return 3;
  if (cpuCount >= 4 && totalMemoryBytes >= 8 * GB) return 2;
  return 1;
}
