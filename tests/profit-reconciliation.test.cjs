const assert = require('node:assert/strict');
const { reconcileProfitRecords } = require('../dist-electron/profit-ledger.js');

function record(id, quantity, completedAt = '2026-08-23T10:00:00.000Z', metadata = {}) {
  return {
    id, characterId: '1', characterName: 'AJ', source: 'industry', sourceKey: id, title: id,
    completedAt, estimatedCost: quantity * 10, estimatedRevenue: quantity * 20, estimatedProfit: quantity * 10,
    actualRevenue: null, actualCost: null, actualTax: null, actualBrokerFees: null, actualProfit: null,
    reconciliationStatus: 'estimated', reconciliationNote: '',
    items: [{ typeId: 42, name: 'Test Product', quantity, expectedUnitSell: 20 }],
    walletTransactionIds: [], walletJournalIds: [], allocations: [], metadata: { productionLotId: id, productionCompletedAt: completedAt, attributedProductionCost: quantity * 10, ...metadata },
  };
}
function sale(id, quantity, date, extras = {}) {
  return { transaction_id: id, journal_ref_id: 9000 + id, order_id: 7000 + id, date, is_buy: false, quantity, type_id: 42, unit_price: 20, ...extras };
}
function snapshot(transactions, journal = []) { return { extended: { walletTransactions: transactions, walletJournal: journal } }; }
function byId(rows, id) { return rows.find((row) => row.id === id); }
function allocated(row) { return (row.allocations ?? []).reduce((sum, item) => sum + item.quantityAllocated, 0); }

// One wallet transaction is globally owned by one record, never duplicated.
{
  const rows = reconcileProfitRecords([record('older', 5), record('newer', 5, '2026-08-23T10:05:00.000Z')], snapshot([
    sale(101, 5, '2026-08-23T11:00:00.000Z'),
  ]));
  assert.deepEqual(byId(rows, 'older').walletTransactionIds, [101]);
  assert.deepEqual(byId(rows, 'newer').walletTransactionIds, []);
  assert.equal(new Set(rows.flatMap((row) => row.walletTransactionIds)).size, rows.flatMap((row) => row.walletTransactionIds).length);
}

// Partial sale allocation is retained as partial and costs are attributed only to sold units.
{
  const row = reconcileProfitRecords([record('partial', 10)], snapshot([sale(102, 4, '2026-08-23T11:00:00.000Z')]))[0];
  assert.equal(row.reconciliationStatus, 'partial');
  assert.equal(allocated(row), 4);
  assert.equal(row.actualRevenue, 80);
  assert.equal(row.actualCost, 40);
}

// Two wallet transactions can complete one production lot when explicit evidence exists.
{
  const r = record('two-sales', 10, undefined, { walletTransactionIds: [103, 104] });
  const row = reconcileProfitRecords([r], snapshot([
    sale(103, 4, '2026-08-23T11:00:00.000Z'),
    sale(104, 6, '2026-08-23T12:00:00.000Z'),
  ]))[0];
  assert.equal(allocated(row), 10);
  assert.equal(row.allocations.length, 2);
  assert.equal(row.reconciliationStatus, 'exact');
}

// Same-type production lots remain distinguishable through persistent/explicit transaction ownership.
{
  const a = record('lot-a', 5, '2026-08-23T10:00:00.000Z', { walletTransactionIds: [105] });
  const b = record('lot-b', 5, '2026-08-23T10:10:00.000Z', { walletTransactionIds: [106] });
  const rows = reconcileProfitRecords([b, a], snapshot([
    sale(105, 5, '2026-08-23T11:00:00.000Z'), sale(106, 5, '2026-08-23T11:10:00.000Z'),
  ]));
  assert.deepEqual(byId(rows, 'lot-a').walletTransactionIds, [105]);
  assert.deepEqual(byId(rows, 'lot-b').walletTransactionIds, [106]);
}

// Persisted/manual ownership is reserved before heuristic matching, so a generic record cannot steal it.
{
  const generic = record('generic', 5, '2026-08-23T10:00:00.000Z');
  const stable = record('stable', 5, '2026-08-23T10:10:00.000Z', { walletTransactionIds: [113] });
  const rows = reconcileProfitRecords([generic, stable], snapshot([sale(113, 5, '2026-08-23T11:00:00.000Z')]));
  assert.deepEqual(byId(rows, 'generic').walletTransactionIds, []);
  assert.deepEqual(byId(rows, 'stable').walletTransactionIds, [113]);
}

// If persisted claims conflict, deterministic oldest-first ownership wins.
{
  const older = record('persisted-older', 5, '2026-08-23T10:00:00.000Z');
  const newer = record('persisted-newer', 5, '2026-08-23T10:10:00.000Z');
  const persisted = { productionLotId: 'lot', walletTransactionId: 114, quantityAllocated: 5, unitPrice: 20, revenue: 100, transactionDate: '2026-08-23T11:00:00.000Z', confidence: 'compatible', evidence: 'product, quantity, price and chronology' };
  older.allocations = [{ ...persisted, productionLotId: older.id }];
  newer.allocations = [{ ...persisted, productionLotId: newer.id }];
  const rows = reconcileProfitRecords([newer, older], snapshot([sale(114, 5, '2026-08-23T11:00:00.000Z')]));
  assert.deepEqual(byId(rows, 'persisted-older').walletTransactionIds, [114]);
  assert.deepEqual(byId(rows, 'persisted-newer').walletTransactionIds, []);
}

// Re-running the same reconciliation is idempotent.
{
  const input = record('idempotent', 8, '2026-08-23T10:00:00.000Z');
  const snap = snapshot([sale(115, 3, '2026-08-23T11:00:00.000Z'), sale(116, 5, '2026-08-23T11:10:00.000Z')]);
  const first = reconcileProfitRecords([input], snap)[0];
  const second = reconcileProfitRecords([first], snap)[0];
  assert.deepEqual(second.allocations, first.allocations);
  assert.deepEqual(second.walletTransactionIds, first.walletTransactionIds);
  assert.equal(second.reconciliationStatus, first.reconciliationStatus);
  assert.equal(second.actualProfit, first.actualProfit);
}

// Tax/broker journal rows cannot be double counted between ledger records.
{
  const a = record('fee-a', 5, undefined, { walletTransactionIds: [107] });
  const b = record('fee-b', 5, undefined, { walletTransactionIds: [108] });
  const rows = reconcileProfitRecords([a, b], snapshot([
    sale(107, 5, '2026-08-23T11:00:00.000Z'), sale(108, 5, '2026-08-23T11:01:00.000Z'),
  ], [
    { id: 5001, date: '2026-08-23T11:00:30.000Z', ref_type: 'transaction_tax', amount: -10, context_id: 107, context_id_type: 'market_transaction_id' },
    { id: 5002, date: '2026-08-23T11:00:30.000Z', ref_type: 'brokers_fee', amount: -2, context_id: 107, context_id_type: 'market_transaction_id' },
  ]));
  assert.equal(rows.reduce((sum, row) => sum + Number(row.actualTax ?? 0), 0), 10);
  assert.equal(rows.reduce((sum, row) => sum + Number(row.actualBrokerFees ?? 0), 0), 2);
  assert.equal(new Set(rows.flatMap((row) => row.walletJournalIds)).size, rows.flatMap((row) => row.walletJournalIds).length);
}

// Time proximity alone is not safe fee attribution: an unlinked nearby journal row stays unclaimed.
{
  const r = record('unsafe-fee', 5, undefined, { walletTransactionIds: [117] });
  const row = reconcileProfitRecords([r], snapshot([sale(117, 5, '2026-08-23T11:00:00.000Z')], [
    { id: 5117, date: '2026-08-23T11:00:01.000Z', ref_type: 'transaction_tax', amount: -99 },
  ]))[0];
  assert.equal(row.actualTax, 0);
  assert.deepEqual(row.walletJournalIds, []);
}

// Sales before the production completion time are never claimed.
{
  const row = reconcileProfitRecords([record('chronology', 5, '2026-08-23T12:00:00.000Z')], snapshot([
    sale(109, 5, '2026-08-23T11:59:59.000Z'),
  ]))[0];
  assert.equal(row.reconciliationStatus, 'estimated');
  assert.deepEqual(row.walletTransactionIds, []);
}

// Compatible product/quantity/price evidence is deliberately not promoted to exact.
{
  const row = reconcileProfitRecords([record('ambiguous', 5)], snapshot([sale(110, 5, '2026-08-23T11:00:00.000Z')]))[0];
  assert.equal(allocated(row), 5);
  assert.equal(row.reconciliationStatus, 'partial');
  assert.match(row.reconciliationNote, /compatible/i);
}


// Corporation wallet divisions participate in the same reconciliation pass as the character wallet.
{
  const r = record('corp-wallet', 5, undefined, { walletTransactionIds: [111] });
  const corpSnapshot = { extended: { walletTransactions: [], walletJournal: [], corporation: { walletHistory: [
    { division: 1, transactions: [sale(111, 5, '2026-08-23T11:00:00.000Z')], journal: [{ id: 5111, date: '2026-08-23T11:00:30.000Z', ref_type: 'transaction_tax', amount: -3, context_id: 111, context_id_type: 'market_transaction_id' }] },
  ] } } };
  const row = reconcileProfitRecords([r], corpSnapshot)[0];
  assert.deepEqual(row.walletTransactionIds, [111]);
  assert.equal(row.actualTax, 3);
  assert.equal(row.reconciliationStatus, 'exact');
}

// Removing explicit evidence downgrades a persisted strong allocation instead of leaving stale exactness behind.
{
  const r = record('released-override', 5);
  r.allocations = [{ productionLotId: 'released-override', walletTransactionId: 112, quantityAllocated: 5, unitPrice: 20, revenue: 100, transactionDate: '2026-08-23T11:00:00.000Z', confidence: 'strong', evidence: 'explicit wallet transaction ID' }];
  const row = reconcileProfitRecords([r], snapshot([sale(112, 5, '2026-08-23T11:00:00.000Z')]))[0];
  assert.equal(row.reconciliationStatus, 'partial');
  assert.equal(row.allocations[0].confidence, 'compatible');
}

// Rejected sale evidence stays rejected across later reconciliation passes.
{
  const r = record('rejected-sale', 5, undefined, { rejectedWalletTransactionIds: [118] });
  const snap = snapshot([sale(118, 5, '2026-08-23T11:00:00.000Z')]);
  const first = reconcileProfitRecords([r], snap)[0];
  const second = reconcileProfitRecords([first], snap)[0];
  assert.deepEqual(first.walletTransactionIds, []);
  assert.deepEqual(second.walletTransactionIds, []);
  assert.deepEqual(second.metadata.rejectedWalletTransactionIds, [118]);
}

// Material purchases are globally reserved to one production lot and cannot be double-used.
{
  const a = record('purchase-owner-a', 5, '2026-08-23T12:00:00.000Z', { materialRequirements: [{ typeId: 34, name: 'Tritanium', required: 10 }], projectCreatedAt: '2026-08-23T09:00:00.000Z' });
  const b = record('purchase-owner-b', 5, '2026-08-23T12:05:00.000Z', { materialRequirements: [{ typeId: 34, name: 'Tritanium', required: 10 }], projectCreatedAt: '2026-08-23T09:00:00.000Z' });
  const buy = { transaction_id: 201, date: '2026-08-23T10:00:00.000Z', is_buy: true, quantity: 10, type_id: 34, unit_price: 4 };
  const rows = reconcileProfitRecords([a, b], snapshot([sale(119, 5, '2026-08-23T13:00:00.000Z'), sale(120, 5, '2026-08-23T13:05:00.000Z'), buy]));
  const owners = rows.filter((row) => (row.purchaseAllocations ?? []).some((x) => x.walletTransactionId === 201));
  assert.equal(owners.length, 1);
  assert.equal(owners[0].id, 'purchase-owner-a');
}

// Provenance changes cash accounting without erasing the frozen economic material value.
{
  const base = record('provenance', 5, '2026-08-23T12:00:00.000Z', { attributedProductionCost: 50, materialReferenceValue: 40, jobCost: 10, materialRequirements: [{ typeId: 34, name: 'Tritanium', required: 10 }], projectCreatedAt: '2026-08-23T09:00:00.000Z', walletTransactionIds: [121] });
  const snap = snapshot([sale(121, 5, '2026-08-23T13:00:00.000Z'), { transaction_id: 202, date: '2026-08-23T10:00:00.000Z', is_buy: true, quantity: 10, type_id: 34, unit_price: 4 }]);
  const mined = reconcileProfitRecords([{ ...base, materialProvenance: { mined: true, donated: false, owned: false, bought: false } }], snap)[0];
  const bought = reconcileProfitRecords([{ ...base, materialProvenance: { mined: false, donated: false, owned: false, bought: true } }], snap)[0];
  assert.equal(mined.cashMaterialCost, 0);
  assert.equal(mined.economicMaterialValue, 40);
  assert.equal(bought.cashMaterialCost, 40);
  assert.equal(bought.economicMaterialValue, 40);
  assert.equal(mined.cashProfit - bought.cashProfit, 40);
  assert.equal(mined.economicProfit, bought.economicProfit);
}
console.log(JSON.stringify({ globalOwnership: true, stableReservation: true, deterministicConflict: true, idempotent: true, partial: true, multiSaleLot: true, distinctLots: true, feesReserved: true, unsafeFeesIgnored: true, chronology: true, ambiguityProtected: true, corporationWallet: true, overrideReleaseSafe: true, rejectionPersistence: true, purchaseOwnership: true, provenanceAccounting: true }));
