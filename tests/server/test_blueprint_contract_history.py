from __future__ import annotations

import gzip
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "modal"))

from blueprint_contract_history import (  # noqa: E402
    DERIVED_CACHE_NAME,
    build_or_update_index,
    query_blueprint_valuations,
    robust_price_statistics,
)

NOW = datetime(2026, 9, 6, 0, 0, tzinfo=timezone.utc)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def blueprint_item(type_id: int, *, copy: bool | None, me: int, te: int, runs: int | None = None, quantity: int = 1, included: bool = True):
    item = {
        "typeId": type_id,
        "typeName": f"Blueprint {type_id}",
        "quantity": quantity,
        "included": included,
        "runs": runs,
        "materialEfficiency": me,
        "timeEfficiency": te,
    }
    if copy is not None:
        item["isBlueprintCopy"] = copy
    return item


def contract(
    contract_id: int,
    type_id: int,
    price: float,
    *,
    copy: bool | None = False,
    me: int = 10,
    te: int = 20,
    runs: int | None = None,
    issued: datetime | None = None,
    expires: datetime | None = None,
    extra_items: list[dict] | None = None,
    contract_type: str = "item_exchange",
):
    issued = issued or (NOW - timedelta(days=3))
    expires = expires or (NOW + timedelta(days=10))
    return {
        "contractId": contract_id,
        "price": price,
        "contractType": contract_type,
        "dateIssued": iso(issued),
        "expires": iso(expires),
        "itemsPending": False,
        "items": [blueprint_item(type_id, copy=copy, me=me, te=te, runs=runs)] + list(extra_items or []),
    }


def write_history(root: Path, observed: datetime, data: dict, suffix: str = "a") -> Path:
    day = observed.date().isoformat()
    folder = root / "public-contracts" / day
    folder.mkdir(parents=True, exist_ok=True)
    stamp = observed.strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    path = folder / f"{stamp}-{suffix}.json.gz"
    payload = {"schemaVersion": 1, "source": "public-contracts", "observedAt": iso(observed), "data": data}
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump(payload, handle)
    return path


def checkpoint(contracts: list[dict], region_id: int = 10000002):
    return {
        "kind": "checkpoint",
        "contractCount": len(contracts),
        "pendingDetailCount": 0,
        "regions": [{"regionId": region_id, "regionName": "The Forge", "publicContracts": contracts}],
    }


def delta(*, upserts: list[dict] | None = None, removed: list[int] | None = None):
    return {
        "kind": "delta",
        "contractCount": len(upserts or []),
        "pendingDetailCount": 0,
        "upserts": list(upserts or []),
        "removedContractIds": list(removed or []),
    }


def query(type_id: int, *, kind: str = "BPO", me: int = 10, te: int = 20, runs: int | None = None, lookback: int = 120):
    payload = {
        "lookbackDays": lookback,
        "queries": [{"typeId": type_id, "blueprintKind": kind, "materialEfficiency": me, "timeEfficiency": te, "runs": runs}],
    }
    return payload


class BlueprintContractHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def result(self, type_id: int, **kwargs):
        return query_blueprint_valuations(self.root, query(type_id, **kwargs), now=NOW)["results"][0]

    def test_checkpoint_ingests_exact_unresearched_bpo(self):
        write_history(self.root, NOW - timedelta(days=2), checkpoint([contract(1, 100, 25_000_000, me=0, te=0)]))
        value = self.result(100, me=0, te=0)
        self.assertEqual(value["estimatedValue"], 25_000_000)
        self.assertEqual(value["valuationSource"], "contract-history-exact")
        self.assertEqual(value["researchMatch"], "exact")
        self.assertEqual(value["sampleCount"], 1)
        self.assertFalse(value["observedSaleEvidence"])

    def test_max_researched_bpo_exact_history_is_distinct_from_unresearched(self):
        rows = [contract(1, 101, 20_000_000, me=0, te=0), contract(2, 101, 42_000_000, me=10, te=20)]
        write_history(self.root, NOW - timedelta(days=2), checkpoint(rows))
        unresearched = self.result(101, me=0, te=0)
        researched = self.result(101, me=10, te=20)
        self.assertEqual(unresearched["estimatedValue"], 20_000_000)
        self.assertEqual(researched["estimatedValue"], 42_000_000)
        self.assertNotEqual(unresearched["estimatedValue"], researched["estimatedValue"])

    def test_missing_copy_flag_is_ingested_as_bpo_original(self):
        row = contract(10, 972, 242_000_000, copy=None, me=10, te=20)
        self.assertNotIn("isBlueprintCopy", row["items"][0])
        write_history(self.root, NOW - timedelta(days=1), checkpoint([row]))
        value = self.result(972, me=10, te=20)
        self.assertEqual(value["blueprintKind"], "BPO")
        self.assertEqual(value["estimatedValue"], 242_000_000)
        self.assertEqual(value["researchMatch"], "exact")

    def test_exact_bpo_estimate_uses_clean_low_high_midpoint_after_twenty_percent_filter(self):
        prices = [199_000_000, 210_000_000, 250_000_000, 285_000_000]
        rows = [contract(index + 20, 973, price) for index, price in enumerate(prices)]
        write_history(self.root, NOW - timedelta(days=1), checkpoint(rows))
        value = self.result(973)
        self.assertEqual(value["estimatedValue"], 224_500_000)
        self.assertEqual(value["lowestAcceptedPrice"], 199_000_000)
        self.assertEqual(value["highestAcceptedPrice"], 250_000_000)
        self.assertEqual(value["outlierCount"], 1)
        self.assertNotEqual(value["estimatedValue"], value["medianValue"])

    def test_max_research_reference_is_returned_for_non_close_bpo_research(self):
        write_history(self.root, NOW - timedelta(days=1), checkpoint([contract(30, 974, 200_000_000, me=10, te=20)]))
        value = self.result(974, me=5, te=10)
        self.assertEqual(value["estimatedValue"], 200_000_000)
        self.assertEqual(value["maxResearchAnchor"], 200_000_000)
        self.assertEqual(value["appliedResearchFraction"], 0.5)
        self.assertEqual(value["researchMatch"], "max-research-reference")
        self.assertEqual(value["valuationSource"], "contract-history-comparable")

    def test_exact_research_outranks_nearby_comparables(self):
        rows = [
            contract(1, 102, 50_000_000, me=10, te=20),
            contract(2, 102, 9_000_000, me=9, te=20),
            contract(3, 102, 10_000_000, me=10, te=18),
        ]
        write_history(self.root, NOW - timedelta(days=1), checkpoint(rows))
        value = self.result(102)
        self.assertEqual(value["estimatedValue"], 50_000_000)
        self.assertEqual(value["exactMatchCount"], 1)
        self.assertEqual(value["rawComparableMatchCount"], 2)

    def test_extremely_close_bpo_research_is_used_when_no_exact_exists(self):
        rows = [contract(1, 103, 12_000_000, me=9, te=20), contract(2, 103, 14_000_000, me=10, te=18)]
        write_history(self.root, NOW - timedelta(days=1), checkpoint(rows))
        value = self.result(103)
        self.assertEqual(value["estimatedValue"], 13_000_000)
        self.assertEqual(value["valuationSource"], "contract-history-comparable")
        self.assertEqual(value["researchMatch"], "extremely-close")
        self.assertEqual(value["confidence"], "medium")

    def test_bpc_requires_same_runs_for_exact_or_comparable_evidence(self):
        rows = [
            contract(1, 200, 4_000_000, copy=True, runs=15),
            contract(2, 200, 20_000_000, copy=True, runs=100),
        ]
        write_history(self.root, NOW - timedelta(days=1), checkpoint(rows))
        fifteen = self.result(200, kind="BPC", runs=15)
        missing = self.result(200, kind="BPC", runs=30)
        self.assertEqual(fifteen["estimatedValue"], 4_000_000)
        self.assertEqual(fifteen["valuationSource"], "bpc-contract-history")
        self.assertIsNone(missing["estimatedValue"])
        self.assertEqual(missing["sampleCount"], 0)

    def test_bpc_never_matches_bpo(self):
        write_history(self.root, NOW - timedelta(days=1), checkpoint([contract(1, 201, 900_000_000, copy=False)]))
        value = self.result(201, kind="BPC", runs=10)
        self.assertIsNone(value["estimatedValue"])
        self.assertEqual(value["valuationSource"], "no-contract-history")

    def test_mixed_bundle_requested_item_and_auction_are_rejected(self):
        requested = blueprint_item(999, copy=False, me=0, te=0, included=False)
        extra = blueprint_item(998, copy=False, me=0, te=0)
        rows = [
            contract(1, 300, 1_000_000, extra_items=[extra]),
            contract(2, 300, 2_000_000, extra_items=[requested]),
            contract(4, 300, 4_000_000, contract_type="auction"),
        ]
        write_history(self.root, NOW - timedelta(days=1), checkpoint(rows))
        value = self.result(300)
        self.assertIsNone(value["estimatedValue"])
        self.assertEqual(value["sampleCount"], 0)

    def test_identical_multi_unit_bpo_contract_is_priceable_per_unit(self):
        row = contract(3, 301, 400_000_000)
        row["items"][0]["quantity"] = 2
        write_history(self.root, NOW - timedelta(days=1), checkpoint([row]))
        value = self.result(301)
        self.assertEqual(value["estimatedValue"], 200_000_000)
        self.assertEqual(value["sampleCount"], 1)

    def test_obvious_extreme_outlier_is_removed_before_low_high_midpoint(self):
        prices = [199_000_000, 205_000_000, 210_000_000, 215_000_000, 4_000_000_000]
        rows = [contract(index + 1, 400, price) for index, price in enumerate(prices)]
        write_history(self.root, NOW - timedelta(days=1), checkpoint(rows))
        value = self.result(400)
        self.assertEqual(value["sampleCount"], 4)
        self.assertEqual(value["outlierCount"], 1)
        self.assertEqual(value["estimatedValue"], 207_000_000)
        self.assertEqual(value["lowestAcceptedPrice"], 199_000_000)
        self.assertEqual(value["highestAcceptedPrice"], 215_000_000)

    def test_multiple_high_outliers_beyond_twenty_percent_are_removed(self):
        prices = [214_000_000, 215_000_000, 218_000_000, 219_000_000, 220_000_000, 120_000_000_000, 125_000_000_000]
        rows = [contract(index + 1, 401, price) for index, price in enumerate(prices)]
        write_history(self.root, NOW - timedelta(days=1), checkpoint(rows))
        value = self.result(401)
        self.assertEqual(value["sampleCount"], 5)
        self.assertEqual(value["outlierCount"], 2)
        self.assertEqual(value["lowestAcceptedPrice"], 214_000_000)
        self.assertEqual(value["highestAcceptedPrice"], 220_000_000)
        self.assertEqual(value["estimatedValue"], 217_000_000)

    def test_multiple_low_outliers_beyond_twenty_percent_are_removed(self):
        prices = [1_000_000, 2_000_000, 210_000_000, 215_000_000, 220_000_000, 225_000_000]
        stats = robust_price_statistics([{"price": price, "contractId": index + 1} for index, price in enumerate(prices)])
        self.assertEqual(stats["sampleCount"], 4)
        self.assertEqual(stats["outlierCount"], 2)
        self.assertEqual(stats["minValue"], 210_000_000)
        self.assertEqual(stats["maxValue"], 225_000_000)
        self.assertEqual(stats["midpointValue"], 217_500_000)

    def test_twenty_percent_filter_repeats_until_market_cluster_is_stable(self):
        prices = [80, 100, 120, 140, 1000]
        stats = robust_price_statistics([{"price": price, "contractId": index + 1} for index, price in enumerate(prices)])
        self.assertEqual([row["price"] for row in stats["samples"]], [100, 120, 140])
        self.assertEqual(stats["outlierCount"], 2)

    def test_split_market_without_clear_cluster_is_not_force_filtered(self):
        prices = [100, 110, 200, 210]
        stats = robust_price_statistics([{"price": price, "contractId": index + 1} for index, price in enumerate(prices)])
        self.assertEqual(stats["sampleCount"], 4)
        self.assertEqual(stats["outlierCount"], 0)

    def test_old_samples_outside_retention_and_lookback_are_ignored(self):
        write_history(self.root, NOW - timedelta(days=121), checkpoint([contract(1, 500, 99_000_000)]), "old")
        write_history(self.root, NOW - timedelta(days=30), checkpoint([contract(2, 500, 30_000_000)]), "mid")
        write_history(self.root, NOW - timedelta(days=2), checkpoint([contract(3, 500, 2_000_000)]), "new")
        value = self.result(500, lookback=7)
        self.assertEqual(value["estimatedValue"], 2_000_000)
        self.assertEqual(value["sampleCount"], 1)

    def test_delta_updates_and_removal_survive_cache_reload(self):
        first = NOW - timedelta(days=3)
        second = NOW - timedelta(days=2)
        third = NOW - timedelta(days=1)
        write_history(self.root, first, checkpoint([contract(1, 600, 10_000_000)]), "checkpoint")
        write_history(self.root, second, delta(upserts=[contract(2, 600, 12_000_000)]), "upsert")
        write_history(self.root, third, delta(removed=[1]), "removed")
        index = build_or_update_index(self.root, now=NOW)
        self.assertEqual(index["sampleCount"], 2)
        self.assertFalse(index["samples"]["1"]["activeAtLastObservation"])
        self.assertEqual(index["samples"]["1"]["removedAt"], iso(third))
        self.assertTrue((self.root / "_derived" / DERIVED_CACHE_NAME).is_file())
        again = build_or_update_index(self.root, now=NOW)
        self.assertEqual(again["processedFilesThisBuild"], 0)
        self.assertEqual(again["samples"]["1"]["removedAt"], iso(third))
        value = self.result(600)
        self.assertEqual(value["estimatedValue"], 11_000_000)
        self.assertEqual(value["removedBeforeExpiryCount"], 1)

    def test_incremental_cache_processes_only_new_history_files(self):
        write_history(self.root, NOW - timedelta(days=2), checkpoint([contract(1, 700, 10_000_000)]), "one")
        first = build_or_update_index(self.root, now=NOW)
        self.assertEqual(first["processedFilesThisBuild"], 1)
        write_history(self.root, NOW - timedelta(days=1), delta(upserts=[contract(2, 700, 20_000_000)]), "two")
        second = build_or_update_index(self.root, now=NOW)
        self.assertEqual(second["processedFilesThisBuild"], 1)
        self.assertEqual(second["sampleCount"], 2)

    def test_query_is_deterministic_for_same_history(self):
        write_history(self.root, NOW - timedelta(days=1), checkpoint([contract(1, 800, 10), contract(2, 800, 20)]))
        first = query_blueprint_valuations(self.root, query(800), now=NOW)
        second = query_blueprint_valuations(self.root, query(800), now=NOW)
        for key in ["estimatedValue", "medianValue", "trimmedMeanValue", "sampleCount", "valuationSource", "researchMatch"]:
            self.assertEqual(first["results"][0][key], second["results"][0][key])

    def test_robust_statistics_handles_sparse_samples_without_false_outlier_removal(self):
        stats = robust_price_statistics([{"price": 10}, {"price": 1000}, {"price": 20}])
        self.assertEqual(stats["sampleCount"], 3)
        self.assertEqual(stats["medianValue"], 20)
        self.assertEqual(stats["outlierCount"], 0)


if __name__ == "__main__":
    unittest.main()
