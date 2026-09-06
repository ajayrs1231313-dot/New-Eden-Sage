export type MarketBuyRanking="nearest"|"highest";
export type MarketBuyRankable={jumpsFromOrigin:number|null;price:number;volumeRemain:number};

export function effectiveMarketOriginId(manualSystemId:number|null|undefined,characterSystemId:number|null|undefined){
  return Number(manualSystemId||0)||Number(characterSystemId||0)||null;
}

export function sortMarketBuyRows<T extends MarketBuyRankable>(rows:T[],ranking:MarketBuyRanking):T[]{
  return [...rows].sort((a,b)=>ranking==="nearest"
    ? Number(a.jumpsFromOrigin??999)-Number(b.jumpsFromOrigin??999)||b.price-a.price||b.volumeRemain-a.volumeRemain
    : b.price-a.price||Number(a.jumpsFromOrigin??999)-Number(b.jumpsFromOrigin??999)||b.volumeRemain-a.volumeRemain);
}
