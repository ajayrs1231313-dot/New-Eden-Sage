const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');
require(path.resolve(__dirname, '../../dist-electron/main.js'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function js(win, code) { return win.webContents.executeJavaScript(code); }

(async () => {
  await app.whenReady();
  let win = null;
  for (let i = 0; i < 60; i += 1) {
    win = BrowserWindow.getAllWindows()[0] || null;
    if (win && !win.webContents.isLoading()) break;
    await sleep(250);
  }
  if (!win) throw new Error('No BrowserWindow created');
  await sleep(1200);

  const assetClicked = await js(win, `(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Asset Command');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!assetClicked) throw new Error('Asset Command button not found');
  await sleep(600);

  const marketClicked = await js(win, `(() => {
    const button = [...document.querySelectorAll('.command-subtabs button')].find((node) => node.textContent.trim() === 'Market');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!marketClicked) throw new Error('Market subtab not found');
  await sleep(700);

  const controlsReady = await js(win, `(() => {
    const input = document.querySelector('.market-v2-item-search input');
    const scope = document.querySelector('.market-v2-query select');
    if (!input || !scope) return false;
    const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    inputSetter.call(input, 'Raven');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    selectSetter.call(scope, 'new-eden');
    scope.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!controlsReady) throw new Error('Market search controls not found');
  await sleep(250);

  const submitted = await js(win, `(() => {
    const button = document.querySelector('.market-v2-search-button');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!submitted) throw new Error('Search market button not found');

  let searchState = null;
  for (let i = 0; i < 90; i += 1) {
    await sleep(500);
    searchState = await js(win, `(() => ({
      selected: document.querySelector('.market-v2-selected-item h3')?.textContent?.trim() || '',
      busy: document.querySelector('.market-v2-search-button')?.textContent?.trim() || '',
      error: document.querySelector('.market-v2-status.error')?.textContent?.trim() || '',
      signalCount: document.querySelectorAll('.market-v2-signal-row').length
    }))()`);
    if (searchState.error) throw new Error(`Market search error: ${searchState.error}`);
    if (searchState.selected === 'Raven' && searchState.signalCount > 0) break;
  }
  if (!searchState || searchState.selected !== 'Raven') throw new Error(`Raven search did not complete: ${JSON.stringify(searchState)}`);
  if (searchState.signalCount < 1) throw new Error('Raven search returned no regional buyer signals');

  const marketInfo = await js(win, `(() => {
    const cards = [...document.querySelectorAll('.market-v2-signal-card')];
    const rows = cards.slice(0, 10).map((card, index) => {
      const row = card.querySelector('.market-v2-signal-row');
      const station = card.querySelector('.market-v2-signal-location strong');
      const sub = card.querySelector('.market-v2-signal-location small');
      const jumpStrong = card.querySelector('.market-v2-signal-jumps strong');
      const jumpSmall = card.querySelector('.market-v2-signal-jumps small');
      const cells = [...row.children].map((cell) => cell.innerText.trim());
      return {
        index,
        unresolved: card.classList.contains('unresolved'),
        station: station?.textContent?.trim() || '',
        subtext: sub?.textContent?.trim() || '',
        jumps: jumpStrong?.textContent?.trim() || '',
        jumpSubtext: jumpSmall?.textContent?.trim() || '',
        cells,
        font: {
          station: station ? getComputedStyle(station).fontSize : '',
          subtext: sub ? getComputedStyle(sub).fontSize : '',
          primary: row?.querySelector('strong') ? getComputedStyle(row.querySelector('strong')).fontSize : '',
          secondary: row?.querySelector('small') ? getComputedStyle(row.querySelector('small')).fontSize : ''
        }
      };
    });
    const firstHead = document.querySelector('.market-v2-signal-head');
    const firstAction = document.querySelector('.market-v2-order-actions button');
    return {
      selected: document.querySelector('.market-v2-selected-item h3')?.textContent?.trim() || '',
      origin: document.querySelector('.market-v2-active-origin strong')?.textContent?.trim() || '',
      coverage: document.querySelector('.market-v2-coverage strong')?.textContent?.trim() || '',
      signalCount: cards.length,
      rows,
      fonts: {
        columnHeader: firstHead ? getComputedStyle(firstHead).fontSize : '',
        detailedAction: firstAction ? getComputedStyle(firstAction).fontSize : '',
        explanation: document.querySelector('.market-v2-regional-signals > header small') ? getComputedStyle(document.querySelector('.market-v2-regional-signals > header small')).fontSize : ''
      }
    };
  })()`);

  const invalidRows = marketInfo.rows.filter((row) => !row.station || /Unresolved market location/i.test(row.station));
  if (invalidRows.length) throw new Error(`Regional buyer rows exposed unresolved locations: ${JSON.stringify(invalidRows)}`);
  const playerFacingText = await js(win, `(() => document.body.innerText)()`);
  for (const forbidden of ['LIMITED DETAILED COVERAGE', 'Complete-source price', 'SOURCE DEPTH', 'DETAILED EXECUTABLE BUY ORDERS']) {
    if (playerFacingText.includes(forbidden)) throw new Error(`Developer market copy is still visible: ${forbidden}`);
  }

  const targetIndex = await js(win, `(() => {
    const cards = [...document.querySelectorAll('.market-v2-signal-card')];
    let index = cards.findIndex((card) => !(card.querySelector('.market-v2-signal-location strong')?.textContent || '').trim().startsWith('Jita'));
    if (index < 0) index = cards.length ? 0 : -1;
    if (index < 0) return -1;
    cards[index].querySelector('.market-v2-signal-row')?.click();
    return index;
  })()`);
  if (targetIndex < 0) throw new Error('No regional buyer row available to expand');
  await sleep(700);

  const expanded = await js(win, `(() => {
    const card = document.querySelector('.market-v2-signal-card.expanded');
    const detail = card?.querySelector('.market-v2-signal-detail');
    const buttons = [...(detail?.querySelectorAll('button') || [])].map((button) => ({
      text: button.textContent.trim(),
      disabled: button.disabled,
      fontSize: getComputedStyle(button).fontSize
    }));
    return {
      text: detail?.innerText?.trim() || '',
      buttons,
      station: card?.querySelector('.market-v2-signal-location strong')?.textContent?.trim() || '',
      systemLine: card?.querySelector('.market-v2-signal-location small')?.textContent?.trim() || ''
    };
  })()`);
  if (!expanded.text.includes('STATION / STRUCTURE') && !expanded.text.includes('BUYER LOCATION')) throw new Error(`Buyer row did not expand correctly: ${expanded.text}`);

  const marketShot = path.resolve(__dirname, 'market-buyer-raven-smoke.png');
  const marketImage = await win.webContents.capturePage();
  fs.writeFileSync(marketShot, marketImage.toPNG());

  const eveStart = await js(win, `(() => {
    const detail = document.querySelector('.market-v2-signal-card.expanded .market-v2-signal-detail');
    const button = [...(detail?.querySelectorAll('button') || [])].find((node) => node.textContent.trim() === 'Add Destination in EVE');
    if (!button) return { found: false };
    return { found: true, disabled: button.disabled, title: button.title };
  })()`);

  const eveStatus = eveStart.found ? (eveStart.disabled ? 'button disabled' : 'button ready') : 'button missing';

  const routeClick = await js(win, `(() => {
    const detail = document.querySelector('.market-v2-signal-card.expanded .market-v2-signal-detail');
    const button = [...(detail?.querySelectorAll('button') || [])].find((node) => node.textContent.trim() === 'Export to Route Planner');
    if (!button) return { found: false };
    if (button.disabled) return { found: true, disabled: true, title: button.title };
    button.click();
    return { found: true, disabled: false, title: button.title };
  })()`);
  await sleep(1200);
  const routeState = await js(win, `(() => ({
    body: document.body.innerText.slice(0, 5000),
    navigationVisible: document.body.innerText.includes('Navigation Command'),
    targetVisible: document.body.innerText.includes(${JSON.stringify(expanded.station)})
  }))()`);

  console.log(JSON.stringify({
    searchState,
    marketInfo,
    targetIndex,
    expanded,
    eveStart,
    eveStatus,
    routeClick,
    routeState: { navigationVisible: routeState.navigationVisible, targetVisible: routeState.targetVisible },
    screenshot: marketShot
  }, null, 2));
  app.exit(0);
})().catch((error) => {
  console.error(error?.stack || error);
  app.exit(1);
});
