import { parentPort } from "node:worker_threads";
import {
  analyzeFittingDogma,
  getFittingCatalogueLocal,
  getHullFittingProfileLocal,
  getMutationOptionsLocal,
  getFittingRemediesLocal,
  getAugmentGuideLocal,
  getBoosterSideEffectsLocal,
  getFittingTypeInfoLocal,
  prepareFittingDataLocal,
  filterFittingItemsForHullLocal,
  getFittingChargesForModulesLocal,
  checkFittingChargeCompatibilityLocal,
  checkFittingItemCompatibilityLocal,
  resolveFittingTypeNamesLocal,
  resolveFittingTypeIdsLocal,
  searchFittingTypesLocal,
} from "./fitting-dogma";

type FittingWorkerOperation =
  | "prepare"
  | "compatible-items"
  | "charges-for-fit"
  | "catalogue"
  | "hull-profile"
  | "mutation-options"
  | "charge-compatibility"
  | "item-compatibility"
  | "remedies"
  | "augment-guide"
  | "booster-side-effects"
  | "type-info"
  | "resolve-types"
  | "resolve-type-ids"
  | "search-types"
  | "analyze";

type FittingWorkerMessage = {
  requestId: number;
  operation: FittingWorkerOperation;
  input?: any;
};

if (!parentPort) throw new Error("Fitting worker requires a parent port.");

parentPort.on("message", async (message: FittingWorkerMessage) => {
  if (!message || !Number.isInteger(message.requestId)) return;
  try {
    let result: unknown;
    switch (message.operation) {
      case "prepare":
        result = await prepareFittingDataLocal((progress) => parentPort!.postMessage({ type:"progress", requestId:message.requestId, progress }));
        break;
      case "compatible-items":
        result = await filterFittingItemsForHullLocal(message.input ?? {});
        break;
      case "charges-for-fit":
        result = await getFittingChargesForModulesLocal(Array.isArray(message.input?.moduleTypeIds) ? message.input.moduleTypeIds : []);
        break;
      case "catalogue":
        result = await getFittingCatalogueLocal();
        break;
      case "hull-profile":
        result = await getHullFittingProfileLocal(Number(message.input?.typeId));
        break;
      case "mutation-options":
        result = await getMutationOptionsLocal(Number(message.input?.typeId));
        break;
      case "charge-compatibility":
        result = await checkFittingChargeCompatibilityLocal(Number(message.input?.moduleTypeId), Number(message.input?.chargeTypeId));
        break;
      case "item-compatibility":
        result = await checkFittingItemCompatibilityLocal(message.input ?? {});
        break;
      case "remedies":
        result = await getFittingRemediesLocal(message.input ?? {});
        break;
      case "augment-guide":
        result = await getAugmentGuideLocal(Array.isArray(message.input?.installedTypeIds) ? message.input.installedTypeIds : []);
        break;
      case "booster-side-effects":
        result = await getBoosterSideEffectsLocal(Array.isArray(message.input?.boosterTypeIds) ? message.input.boosterTypeIds : []);
        break;
      case "type-info":
        result = await getFittingTypeInfoLocal(Number(message.input?.typeId));
        break;
      case "resolve-types":
        result = await resolveFittingTypeNamesLocal(Array.isArray(message.input?.names) ? message.input.names : []);
        break;
      case "resolve-type-ids":
        result = await resolveFittingTypeIdsLocal(Array.isArray(message.input?.typeIds) ? message.input.typeIds : []);
        break;
      case "search-types":
        result = await searchFittingTypesLocal(String(message.input?.query ?? ""), Number(message.input?.limit ?? 60));
        break;
      case "analyze":
        result = await analyzeFittingDogma(message.input);
        break;
      default:
        throw new Error(`Unknown fitting worker operation: ${String(message.operation)}`);
    }
    parentPort!.postMessage({ type: "result", requestId: message.requestId, result });
  } catch (error) {
    parentPort!.postMessage({
      type: "error",
      requestId: message.requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});
