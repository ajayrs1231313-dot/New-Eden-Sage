const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function js(win, code) { return win.webContents.executeJavaScript(code); }

for (const [channel, value] of [
  ['config:get', {}],
  ['snapshot:list', []],
  ['display-fit:set', { enabled: false }],
  ['display-fit:refresh', { enabled: false }],
]) ipcMain.handle(channel, () => value);

const fixtures = [
  ['Hedbergite II-Grade', 17440, 34416, 526.1],
  ['Hedbergite III-Grade', 17441, 13120, 551.7],
  ['Hedbergite', 21, 36781, 503.7],
  ['Mordunium II-Grade', 74522, 1529270, 10.78],
  ['Mordunium IV-Grade', 74524, 3438525, 10],
  ['Omber II-Grade', 17867, 87838, 100.6],
  ['Omber III-Grade', 17868, 97721, 96.26],
  ['Omber IV-Grade', 46684, 167962, 100],
];

ipcMain.handle('market:search-ore-types', (_event, input) => {
  const query = String(input?.query || '').toLowerCase();
  return query.includes('veld') ? [{ typeId: 1230, name: 'Veldspar', categoryId: 25, categoryName: 'Asteroid' }] : [];
});

ipcMain.handle('market:quote-depth', (_event, input) => {
  const items = fixtures.map(([itemName, typeId, requestedQuantity, price], index) => ({
    inputName: input?.items?.[index]?.name ?? itemName,
    itemName,
    typeId,
    requestedQuantity,
    filledQuantity: requestedQuantity,
    unfilledQuantity: 0,
    highestBidUsed: price,
    lowestBidCrossed: price,
    weightedAverageRealisedUnitPrice: price,
    ordersCrossed: 1,
    totalRealisedIsk: requestedQuantity * price,
    fullMarketDepthSufficient: true,
  }));
  return {
    createdAt: new Date().toISOString(),
    locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    source: { kind: 'desktop-smoke', createdAt: new Date().toISOString(), freshRequested: Boolean(input?.fresh) },
    items,
    grandTotalRealisedIsk: items.reduce((sum, item) => sum + item.totalRealisedIsk, 0),
    totalUnfilledQuantity: 0,
    fullMarketDepthSufficient: true,
  };
});

(async () => {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, '../../dist-electron/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadFile(path.resolve(__dirname, '../../dist/index.html'));
  await sleep(1000);

  const corporationClicked = await js(win, `(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Corporation Command');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!corporationClicked) throw new Error('Corporation Command navigation button not found');
  await sleep(350);

  const buybackClicked = await js(win, `(() => {
    const button = [...document.querySelectorAll('.corp-subtabs button')].find((node) => node.textContent.trim() === 'Corp Ore Buyback');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!buybackClicked) throw new Error('Corp Ore Buyback subtab not found');
  await sleep(350);

  const initial = await js(win, `(() => ({
    visible: Boolean(document.querySelector('.corp-buyback')),
    textarea: document.querySelector('.corp-buyback textarea')?.value || '',
    payout: document.querySelector('.corp-buyback input[type="number"]')?.value || '',
    buttons: [...document.querySelectorAll('.corp-buyback button')].map((button) => button.textContent.trim()),
  }))()`);
  if (!initial.visible) throw new Error('Corp Ore Buyback panel did not render');
  if (!initial.textarea.includes('Hedbergite II')) throw new Error('Buyback paste area did not render the regression batch');
  if (initial.payout !== '90') throw new Error(`Default payout was not 90%: ${initial.payout}`);
  if (!initial.buttons.includes('Calculate') || !initial.buttons.includes('Recalculate using fresh market data')) throw new Error(`Buyback actions missing: ${JSON.stringify(initial.buttons)}`);

  const calculated = await js(win, `(() => {
    const button = [...document.querySelectorAll('.corp-buyback button')].find((node) => node.textContent.trim() === 'Calculate');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!calculated) throw new Error('Calculate action was unavailable');

  let result = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(100);
    result = await js(win, `(() => ({
      rows: document.querySelectorAll('.corp-buyback-table tbody tr').length,
      totalCards: [...document.querySelectorAll('.corp-buyback-totals article strong')].map((node) => node.textContent.trim()),
      message: document.querySelector('.corp-buyback .system-status')?.textContent?.trim() || '',
      warningRows: document.querySelectorAll('.corp-buyback-table tbody tr.warning').length,
      copyButtons: [...document.querySelectorAll('.corp-buyback-actions button')].map((node) => node.textContent.trim()),
    }))()`);
    if (result.rows === 8) break;
  }
  if (!result || result.rows !== 8) throw new Error(`Depth result table did not populate all 8 rows: ${JSON.stringify(result)}`);
  if (result.totalCards.length !== 3) throw new Error(`Buyback summary cards missing: ${JSON.stringify(result)}`);
  if (result.warningRows !== 0) throw new Error(`Unexpected insufficient-depth warning rows: ${JSON.stringify(result)}`);
  if (!result.copyButtons.includes('Copy Results') || !result.copyButtons.includes('Copy Summary')) throw new Error(`Copy actions missing: ${JSON.stringify(result.copyButtons)}`);

  const quickAdd = await js(win, `(async () => {
    const search = document.querySelector('.corp-buyback-search-input');
    if (!search) return { ok:false, step:'search-input' };
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(search, 'veld');
    search.dispatchEvent(new Event('input', { bubbles:true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    const option = [...document.querySelectorAll('.corp-buyback-search-results button')].find((node) => node.textContent.includes('Veldspar'));
    if (!option) return { ok:false, step:'search-result', text:document.querySelector('.corp-buyback-search-message')?.textContent || '' };
    option.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const quantity = document.querySelector('.corp-buyback-add-quantity input');
    set.call(quantity, '12345');
    quantity.dispatchEvent(new Event('input', { bubbles:true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const add = document.querySelector('.corp-buyback-add-button');
    if (!add || add.disabled) return { ok:false, step:'add-button' };
    add.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { ok:(document.querySelector('.corp-buyback textarea')?.value || '').includes('Veldspar: 12,345'), value:document.querySelector('.corp-buyback textarea')?.value || '' };
  })()`);
  if (!quickAdd.ok) throw new Error(`Jita ore quick-add failed: ${JSON.stringify(quickAdd)}`);

  console.log(JSON.stringify({ initial: { payout: initial.payout, buttons: initial.buttons }, result, quickAdd: quickAdd.ok }, null, 2));
  win.destroy();
  app.exit(0);
})().catch((error) => {
  console.error(error?.stack || error);
  app.exit(1);
});
