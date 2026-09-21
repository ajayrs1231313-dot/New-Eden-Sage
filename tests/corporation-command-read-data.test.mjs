import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildCorporationReadData } from "../src/corporation-command-data.ts";

test("corporation read data uses the freshest successful shared dataset across connected characters", () => {
  const snapshots = [
    {
      characterId: "old-authority",
      updatedAt: "2026-09-15T10:00:00Z",
      character: { corporation_id: 42, name: "Old Authority" },
      extended: { corporation: {
        publicData: { name: "Corp", member_count: 40 },
        structures: [{ structure_id: 1 }],
        assets: { unavailable: true, error: "ESI request failed (403)" },
        roles: { roles: ["Director"] },
      } },
    },
    {
      characterId: "fresh-authority",
      updatedAt: "2026-09-21T10:00:00Z",
      character: { corporation_id: 42, name: "Fresh Authority" },
      extended: { corporation: {
        publicData: { name: "Corp", member_count: 51 },
        structures: [{ structure_id: 1 }, { structure_id: 2 }],
        assets: [{ item_id: 9 }],
        memberLimit: 8600,
        roles: { roles: ["Accountant"] },
      } },
    },
  ];

  const result = buildCorporationReadData(snapshots, 42, "old-authority");
  assert.equal(result.data.structures.length, 2);
  assert.equal(result.data.assets.length, 1);
  assert.equal(result.data.memberLimit, 8600);
  assert.deepEqual(result.data.roles, { roles: ["Director"] }, "selected-character role data must stay selected-character scoped");
  assert.equal(result.publicData.member_count, 51);
  assert.equal(result.datasetSources.structures, "fresh-authority");
});

test("an unavailable newer snapshot falls back to the freshest successful corporation dataset", () => {
  const snapshots = [
    {
      characterId: "new-no-access",
      updatedAt: "2026-09-21T10:00:00Z",
      character: { corporation_id: 42 },
      extended: { corporation: { structures: { unavailable: true, error: "ESI request failed (403)" } } },
    },
    {
      characterId: "older-access",
      updatedAt: "2026-09-20T10:00:00Z",
      character: { corporation_id: 42 },
      extended: { corporation: { structures: [{ structure_id: 7 }] } },
    },
  ];
  const result = buildCorporationReadData(snapshots, 42, "new-no-access");
  assert.deepEqual(result.data.structures, [{ structure_id: 7 }]);
});

test("Corporation Structures resolves facility system_id and Overview uses the modern corporation tax_rates object", () => {
  const source = fs.readFileSync(path.resolve("src/CorporationManagement.tsx"), "utf8");
  assert.match(source, /resolve\(item\.system_id \?\? item\.solar_system_id,/);
  assert.match(source, /formatCorporationTax\(p\.tax_rates\?\.isk \?\? p\.tax_rate\)/);
  assert.match(source, /match\(\/\\\(\(\\d\{3\}\)\\\)\//);
});
