import { RegionalMarketFilterPanel as Task9RegionalMarketFilterPanel } from "./RegionalMarketFilterPanelTask9";
import { MarketIntelligencePanel } from "./MarketIntelligencePanel";
import "./market-intelligence-task10.css";

export function RegionalMarketFilterPanel({ dataRevision = 0 }: { dataRevision?: number }) {
  return (
    <>
      <Task9RegionalMarketFilterPanel dataRevision={dataRevision} />
      <MarketIntelligencePanel />
    </>
  );
}
