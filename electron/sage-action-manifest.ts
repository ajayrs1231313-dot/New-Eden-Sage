// Generated from src/types.ts by scripts/build-sage-action-manifest.cjs.
export const SAGE_ACTION_MANIFEST: Record<string, { parameters: Array<{ name: string; optional: boolean; type?: string }>; returns?: string }> = {
  "setDisplayFitEnabled": {
    "parameters": [
      {
        "name": "enabled",
        "optional": false,
        "type": "boolean"
      }
    ],
    "returns": "Promise<{ enabled: boolean }>"
  },
  "refreshDisplayFit": {
    "parameters": [],
    "returns": "Promise<boolean>"
  },
  "onDisplayFitChanged": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(enabled: boolean) => void"
      }
    ],
    "returns": "() => void"
  },
  "getUpdateState": {
    "parameters": [],
    "returns": "Promise<{ version: string; packaged: boolean }>"
  },
  "checkForUpdates": {
    "parameters": [],
    "returns": "Promise<unknown>"
  },
  "downloadUpdate": {
    "parameters": [],
    "returns": "Promise<unknown>"
  },
  "installUpdate": {
    "parameters": [],
    "returns": "Promise<boolean>"
  },
  "openSupportPage": {
    "parameters": [],
    "returns": "Promise<void>"
  },
  "openWindowsSnip": {
    "parameters": [],
    "returns": "Promise<boolean>"
  },
  "openZkillboard": {
    "parameters": [
      {
        "name": "killmailId",
        "optional": true,
        "type": "number"
      }
    ],
    "returns": "Promise<void>"
  },
  "openExternalUrl": {
    "parameters": [
      {
        "name": "url",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<void>"
  },
  "openDiscordUrl": {
    "parameters": [
      {
        "name": "url",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<void>"
  },
  "getMcpSetup": {
    "parameters": [],
    "returns": "Promise<{ command: string; args: string[]; json: string; codex: string; access: string; claudeDesktop: string; claudeCode: string }>"
  },
  "getClaudeMcpStatus": {
    "parameters": [],
    "returns": "Promise<ClaudeCompatibilityStatus>"
  },
  "repairClaudeMcp": {
    "parameters": [],
    "returns": "Promise<ClaudeCompatibilityStatus>"
  },
  "repairClaudeDirectMcp": {
    "parameters": [],
    "returns": "Promise<ClaudeCompatibilityStatus[\"desktop\"]>"
  },
  "showClaudeMcpBundle": {
    "parameters": [],
    "returns": "Promise<string>"
  },
  "getMcpTunnelStatus": {
    "parameters": [],
    "returns": "Promise<{ configured: boolean; tunnelId: string; running: boolean; ready: boolean; healthUrl: string }>"
  },
  "configureMcpTunnel": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ tunnelId: string; runtimeKey: string }"
      }
    ],
    "returns": "Promise<{ configured: boolean; tunnelId: string; running: boolean; ready: boolean; healthUrl: string }>"
  },
  "openChatGptPlugins": {
    "parameters": [],
    "returns": "Promise<void>"
  },
  "openOpenAiTunnels": {
    "parameters": [],
    "returns": "Promise<void>"
  },
  "openOpenAiApiKeys": {
    "parameters": [],
    "returns": "Promise<void>"
  },
  "loadFittingPersistence": {
    "parameters": [
      {
        "name": "legacyValue",
        "optional": false,
        "type": "unknown"
      }
    ],
    "returns": "Promise<{ schemaVersion:number; migrationVersion:number; savedFits:unknown[]; fitLibraryMeta:Record<string, unknown>; selectedFitId?:string; updatedAt?:string; migratedAt?:string }>"
  },
  "saveFittingPersistence": {
    "parameters": [
      {
        "name": "value",
        "optional": false,
        "type": "unknown"
      }
    ],
    "returns": "Promise<{ schemaVersion:number; migrationVersion:number; savedFits:unknown[]; fitLibraryMeta:Record<string, unknown>; selectedFitId?:string; updatedAt?:string; migratedAt?:string }>"
  },
  "syncMcpRendererData": {
    "parameters": [
      {
        "name": "value",
        "optional": false,
        "type": "unknown"
      }
    ],
    "returns": "Promise<boolean>"
  },
  "onMcpFitDataUpdated": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(value: { savedFits?: unknown[]; fitLibraryMeta?: Record<string, unknown>; selectedFitId?: string }) => void"
      }
    ],
    "returns": "() => void"
  },
  "onUpdateStatus": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(value: { status: string; detail?: any }) => void"
      }
    ],
    "returns": "() => void"
  },
  "getHostClock": {
    "parameters": [],
    "returns": "Promise<{now:string;platform:string;timezone:string;offsetMinutes:number;hostname:string}>"
  },
  "syncHostClock": {
    "parameters": [],
    "returns": "Promise<{ok:boolean;message:string;clock:{now:string;platform:string;timezone:string;offsetMinutes:number}}>"
  },
  "setHostClock": {
    "parameters": [
      {
        "name": "value",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<{ok:boolean;message:string;clock:{now:string;platform:string;timezone:string;offsetMinutes:number}}>"
  },
  "submitUsageMetrics": {
    "parameters": [
      {
        "name": "batch",
        "optional": false,
        "type": "UsageMetricBatch"
      }
    ],
    "returns": "Promise<{accepted:number;connected?:number}>"
  },
  "getUsagePresence": {
    "parameters": [],
    "returns": "Promise<UsagePresence>"
  },
  "getNotificationRules": {
    "parameters": [],
    "returns": "Promise<{rules:SageNotificationRule[]}>"
  },
  "createNotificationRule": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "SageNotificationRuleInput"
      }
    ],
    "returns": "Promise<{rule:SageNotificationRule}>"
  },
  "updateNotificationRule": {
    "parameters": [
      {
        "name": "requestId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "rule",
        "optional": false,
        "type": "Partial<SageNotificationRuleInput>"
      }
    ],
    "returns": "Promise<{rule:SageNotificationRule}>"
  },
  "deleteNotificationRule": {
    "parameters": [
      {
        "name": "requestId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<{deleted:boolean;requestId:string}>"
  },
  "getNotificationInbox": {
    "parameters": [
      {
        "name": "input",
        "optional": true,
        "type": "{limit?:number;includeAcknowledged?:boolean}"
      }
    ],
    "returns": "Promise<SageNotificationInbox>"
  },
  "acknowledgeNotification": {
    "parameters": [
      {
        "name": "eventId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<{acknowledged:boolean;eventId:string;acknowledgedAt:string}>"
  },
  "getSageMailbox": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;folder?:SageMailFolder}"
      }
    ],
    "returns": "Promise<SageMailbox>"
  },
  "getSageMailDirectory": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<SageMailDirectory>"
  },
  "sendSageMail": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{senderCharacterId:string;recipientCharacterId:number;subject:string;body:string}"
      }
    ],
    "returns": "Promise<{sent:boolean;messageId:string;senderCharacterId:number;recipientCharacterId:number;relationships:string[];senderQuota:SageMailQuota}>"
  },
  "markSageMailRead": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;entryId:number}"
      }
    ],
    "returns": "Promise<{read:boolean;entryId:number;quota:SageMailQuota}>"
  },
  "deleteSageMail": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;entryId:number}"
      }
    ],
    "returns": "Promise<{deleted:boolean;entryId:number;quota:SageMailQuota}>"
  },
  "sendSageDoctrineMail": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;subject:string;body:string;dedupKey:string;metadata?:Record<string,unknown>}"
      }
    ],
    "returns": "Promise<{sent:boolean;corporationId:number;eligibleRecipients:number;delivered:number;duplicates:number;skippedFull:number}>"
  },
  "getEveMailbox": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;limit?:number}"
      }
    ],
    "returns": "Promise<EveMailMailbox>"
  },
  "getEveMailMessage": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;mailId:number}"
      }
    ],
    "returns": "Promise<EveMailMessage>"
  },
  "sendEveMail": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;recipients:string[];subject:string;body:string}"
      }
    ],
    "returns": "Promise<{sent:boolean;mailId:number;recipients:Array<{recipient_id:number;recipient_type:\"character\"|\"corporation\"|\"alliance\"|\"mailing_list\";name:string}>}>"
  },
  "markEveMailRead": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;mailId:number;labels?:number[]}"
      }
    ],
    "returns": "Promise<{read:boolean;mailId:number}>"
  },
  "deleteEveMail": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;mailId:number}"
      }
    ],
    "returns": "Promise<{deleted:boolean;mailId:number}>"
  },
  "onNotificationsUpdated": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(value:SageNotificationInbox)=>void"
      }
    ],
    "returns": "() => void"
  },
  "getGlobalMarketQuotes": {
    "parameters": [
      {
        "name": "typeIds",
        "optional": false,
        "type": "number[]"
      }
    ],
    "returns": "Promise<{createdAt:string|null;quotes:Array<{typeId:number;typeName:string;bestBuy:number|null;bestSell:number|null;bestBuySystem:string|null;bestSellSystem:string|null}>}>"
  },
  "getLpCorporations": {
    "parameters": [
      {
        "name": "corporationIds",
        "optional": false,
        "type": "number[]"
      }
    ],
    "returns": "Promise<Array<{corporationId:number;corporationName:string}>>"
  },
  "getLpStoreOffers": {
    "parameters": [
      {
        "name": "corporationId",
        "optional": false,
        "type": "number"
      },
      {
        "name": "marketRevision",
        "optional": true,
        "type": "number"
      }
    ],
    "returns": "Promise<any>"
  },
  "getLpEarningCandidates": {
    "parameters": [
      {
        "name": "standings",
        "optional": false,
        "type": "unknown"
      },
      {
        "name": "currentCorporationIds",
        "optional": false,
        "type": "number[]"
      }
    ],
    "returns": "Promise<any[]>"
  },
  "getContractMarketWorkspace": {
    "parameters": [],
    "returns": "Promise<MarketContractWorkspace>"
  },
  "searchMarketContracts": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "MarketContractSearchQuery"
      }
    ],
    "returns": "Promise<MarketContractSearchResult>"
  },
  "getProfitLedger": {
    "parameters": [
      {
        "name": "characterId",
        "optional": true,
        "type": "string"
      }
    ],
    "returns": "Promise<ProfitLedgerRecord[]>"
  },
  "completeProfitDeal": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "ProfitLedgerCompleteInput"
      }
    ],
    "returns": "Promise<ProfitLedgerRecord>"
  },
  "reconcileProfitLedger": {
    "parameters": [
      {
        "name": "characterId",
        "optional": true,
        "type": "string"
      }
    ],
    "returns": "Promise<ProfitLedgerRecord[]>"
  },
  "removeProfitLedgerRecord": {
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<boolean>"
  },
  "getProfitReconciliationReview": {
    "parameters": [
      {
        "name": "recordId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<ProfitReconciliationReview>"
  },
  "setProfitTransactionOverride": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ recordId:string; walletTransactionId:number; assigned:boolean }"
      }
    ],
    "returns": "Promise<{ record:ProfitLedgerRecord; review:ProfitReconciliationReview }>"
  },
  "setProfitMatchDecision": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{recordId:string;walletTransactionId:number;decision:\"confirmed\"|\"rejected\"}"
      }
    ],
    "returns": "Promise<ProfitLedgerRecord>"
  },
  "setProfitMaterialProvenance": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{recordId:string;mined:boolean;donated:boolean;owned:boolean;bought:boolean}"
      }
    ],
    "returns": "Promise<ProfitLedgerRecord>"
  },
  "getProfitPurchaseReview": {
    "parameters": [
      {
        "name": "recordId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<ProfitPurchaseReview>"
  },
  "setProfitPurchaseTransactionOverride": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{recordId:string;walletTransactionId:number;assigned:boolean}"
      }
    ],
    "returns": "Promise<{record:ProfitLedgerRecord;review:ProfitPurchaseReview}>"
  },
  "applyProfitBulkBookkeeping": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{recordIds:string[];matchDecision?:\"confirmed\"|\"rejected\";transactionDecisions?:Array<{recordId:string;walletTransactionId:number;decision:\"confirmed\"|\"rejected\"}>;provenance?:{mined:boolean;donated:boolean;owned:boolean;bought:boolean}}"
      }
    ],
    "returns": "Promise<ProfitLedgerRecord[]>"
  },
  "onWalletReconciled": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(value:{refreshed?:number;failed?:number;ledgerRecords?:number;completedAt?:string})=>void"
      }
    ],
    "returns": "() => void"
  },
  "openEveContract": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId: string; contractId: number }"
      }
    ],
    "returns": "Promise<{ success: boolean; contractId: number; characterId: string; characterName: string; usedFallback: boolean }>"
  },
  "openEveMarketType": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId: string; typeId: number }"
      }
    ],
    "returns": "Promise<{ success: boolean; typeId: number; characterId: string; characterName: string; usedFallback: boolean }>"
  },
  "getPlanetaryRevenue": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId:string; settings?:PlanetaryRevenueSettings }"
      }
    ],
    "returns": "Promise<PlanetaryRevenueAnalysis>"
  },
  "getPlanetaryPlan": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "PlanetaryPlanInput"
      }
    ],
    "returns": "Promise<PlanetaryPlanResult>"
  },
  "getPlanetaryState": {
    "parameters": [],
    "returns": "Promise<PlanetaryPersistentState>"
  },
  "savePlanetaryPlan": {
    "parameters": [
      {
        "name": "plan",
        "optional": false,
        "type": "PlanetarySavedPlan"
      }
    ],
    "returns": "Promise<PlanetarySavedPlan>"
  },
  "deletePlanetaryPlan": {
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<boolean>"
  },
  "savePlanetaryObservations": {
    "parameters": [
      {
        "name": "observations",
        "optional": false,
        "type": "PlanetaryResourceObservation[]"
      }
    ],
    "returns": "Promise<PlanetaryResourceObservation[]>"
  },
  "savePlanetaryAlertSettings": {
    "parameters": [
      {
        "name": "settings",
        "optional": false,
        "type": "PlanetaryAlertSettings"
      }
    ],
    "returns": "Promise<PlanetaryAlertSettings>"
  },
  "getPlanetaryBasket": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "Record<string,unknown>"
      }
    ],
    "returns": "Promise<any>"
  },
  "evaluatePlanetaryLayout": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "PlanetaryDesignerInput"
      }
    ],
    "returns": "Promise<any>"
  },
  "generatePlanetaryLayouts": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "PlanetaryDesignerInput"
      }
    ],
    "returns": "Promise<PlanetaryDesignerCandidate[]>"
  },
  "buildPlanetaryDesignerEveTemplate": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{designer:PlanetaryDesignerInput;baseTemplate:any;comment?:string}"
      }
    ],
    "returns": "Promise<{template:any|null;warnings:string[]}>"
  },
  "getPlanetaryDesignerSeed": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "Record<string,unknown>"
      }
    ],
    "returns": "Promise<any>"
  },
  "getCorporationDiscordState": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<any>"
  },
  "getCorporationDiscordServerStructure": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<any>"
  },
  "configureCorporationDiscord": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;guildId:string;channelId:string;allowedChannelIds?:string[];enabled:boolean}"
      }
    ],
    "returns": "Promise<any>"
  },
  "getCorporationDiscordLinkUrl": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<{url:string;expiresInSeconds:number}>"
  },
  "sendCorporationDiscordAnnouncement": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;content:string;channelId?:string;roleIds?:string[];userIds?:string[]}"
      }
    ],
    "returns": "Promise<{sent:boolean;messageId?:string}>"
  },
  "updateCorporationDiscordNotificationTargets": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;characterIds:number[]}"
      }
    ],
    "returns": "Promise<any>"
  },
  "testCorporationDiscordDm": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<{sent:boolean;messageId?:string}>"
  },
  "unlinkCorporationDiscord": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<{unlinked:boolean}>"
  },
  "getCorporationRolesState": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<any>"
  },
  "updateCorporationRolePermission": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;permissionKey:string;authorities:Array<{type:\"eve_role\"|\"eve_title\";value:string}>}"
      }
    ],
    "returns": "Promise<any>"
  },
  "getCorporationOpsWorkspace": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<any>"
  },
  "listCorporationOperations": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{workspaceId:string}"
      }
    ],
    "returns": "Promise<any[]>"
  },
  "publishCorporationOperation": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;payload:Record<string,unknown>}"
      }
    ],
    "returns": "Promise<any>"
  },
  "updateCorporationOperation": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;workspaceId:string;objectId:string;payload:Record<string,unknown>;expectedVersion:number}"
      }
    ],
    "returns": "Promise<any>"
  },
  "announceCorporationOperationDiscord": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;workspaceId:string;objectId:string}"
      }
    ],
    "returns": "Promise<any>"
  },
  "cancelCorporationOperation": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;workspaceId:string;objectId:string;message?:string;announceCancellation?:boolean}"
      }
    ],
    "returns": "Promise<{discordDeleted:boolean;discordCleanupWarning?:string;legacyLookup?:boolean;discordCancellationRequested?:boolean;discordCancellationSent?:boolean;discordCancellationMessageId?:string;discordCancellationWarning?:string}>"
  },
  "takeCorporationOperationOwnership": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;workspaceId:string;objectId:string}"
      }
    ],
    "returns": "Promise<any>"
  },
  "setCorporationOperationApplicationNotifications": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;workspaceId:string;objectId:string;enabled:boolean}"
      }
    ],
    "returns": "Promise<any>"
  },
  "applyCorporationOperationRole": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;workspaceId:string;objectId:string;roleId:string;fitName?:string;fitText?:string;hullName?:string}"
      }
    ],
    "returns": "Promise<any>"
  },
  "decideCorporationOperationApplication": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;workspaceId:string;objectId:string;applicationId:string;decision:\"approved\"|\"denied\";message?:string}"
      }
    ],
    "returns": "Promise<any>"
  },
  "getPlanetaryCorpState": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string}"
      }
    ],
    "returns": "Promise<any>"
  },
  "publishPlanetaryCorpSurvey": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "Record<string,unknown>"
      }
    ],
    "returns": "Promise<any>"
  },
  "publishPlanetaryCorpTemplate": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;planId:string}"
      }
    ],
    "returns": "Promise<PlanetarySavedPlan>"
  },
  "unpublishPlanetaryCorpObject": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;planId:string;objectId:string}"
      }
    ],
    "returns": "Promise<PlanetarySavedPlan|boolean>"
  },
  "getFitterContentConfig": {
    "parameters": [],
    "returns": "Promise<{ path:string; rules:unknown[] }>"
  },
  "getAugmentGuideLocal": {
    "parameters": [
      {
        "name": "installedTypeIds",
        "optional": false,
        "type": "number[]"
      }
    ],
    "returns": "Promise<AugmentGuideResult>"
  },
  "getBoosterSideEffectsLocal": {
    "parameters": [
      {
        "name": "boosterTypeIds",
        "optional": false,
        "type": "number[]"
      }
    ],
    "returns": "Promise<Array<{ boosterTypeId:number; boosterName:string; effectId:number; effectName:string; chanceAttributeId:number; chance:number }>>"
  },
  "copyText": {
    "parameters": [
      {
        "name": "value",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<boolean>"
  },
  "resolveTypeNames": {
    "parameters": [
      {
        "name": "names",
        "optional": false,
        "type": "string[]"
      }
    ],
    "returns": "Promise<Array<{ id: number; name: string }>>"
  },
  "resolveFittingTypeNamesLocal": {
    "parameters": [
      {
        "name": "names",
        "optional": false,
        "type": "string[]"
      }
    ],
    "returns": "Promise<Array<{ id: number; name: string; groupId?: number; categoryId?: number; categoryName?: string; rack?: \"low\" | \"mid\" | \"high\" | \"rig\" | \"subsystem\" }>>"
  },
  "resolveFittingTypeIdsLocal": {
    "parameters": [
      {
        "name": "typeIds",
        "optional": false,
        "type": "number[]"
      }
    ],
    "returns": "Promise<Array<{ id: number; name: string; groupId?: number; categoryId?: number; categoryName?: string; rack?: \"low\" | \"mid\" | \"high\" | \"rig\" | \"subsystem\" }>>"
  },
  "searchFittingTypesLocal": {
    "parameters": [
      {
        "name": "query",
        "optional": false,
        "type": "string"
      },
      {
        "name": "limit",
        "optional": true,
        "type": "number"
      }
    ],
    "returns": "Promise<Array<{ id: number; name: string; groupId: number; categoryId: number; categoryName: string; rack?: \"low\" | \"mid\" | \"high\" | \"rig\" | \"subsystem\"; combatProfile?: { abyssal:boolean; outgoingDamage:{em:number;thermal:number;kinetic:number;explosive:number}; outgoingDamageTotal:number; shieldHp:number; armorHp:number; structureHp:number; shieldResists:[number,number,number,number]; armorResists:[number,number,number,number]; hullResists:[number,number,number,number]; signatureRadiusM:number } }>>"
  },
  "prepareFittingDataLocal": {
    "parameters": [],
    "returns": "Promise<{ catalogue:{ groups:Array<{id:number;name:string;parentId?:number;iconId?:number}>; items:Array<any> }; preparedAt:string; itemCount:number; groupCount:number; durationMs:number }>"
  },
  "onFittingPreparationProgress": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(value:{percent:number;stage:string;message:string})=>void"
      }
    ],
    "returns": "() => void"
  },
  "filterFittingItemsForHullLocal": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{hullTypeId:number;candidates:Array<{typeId:number;placement?:string}>;fitted?:Array<{typeId:number;rack?:string}>}"
      }
    ],
    "returns": "Promise<{compatibleTypeIds:number[];checked:number}>"
  },
  "getFittingChargesForModulesLocal": {
    "parameters": [
      {
        "name": "moduleTypeIds",
        "optional": false,
        "type": "number[]"
      }
    ],
    "returns": "Promise<{compatibleTypeIds:number[];checked:number}>"
  },
  "getFittingCatalogueLocal": {
    "parameters": [],
    "returns": "Promise<{ groups: Array<{ id:number; name:string; parentId?:number; iconId?:number }>; items: Array<{ id:number; name:string; groupId:number; categoryId:number; categoryName:string; rack?: \"low\" | \"mid\" | \"high\" | \"rig\" | \"subsystem\"; marketGroupId:number; rootName:string; metaLevel:number; placement:\"ship\"|\"high\"|\"mid\"|\"low\"|\"rig\"|\"subsystem\"|\"drone\"|\"fighter\"|\"implant\"|\"booster\"|\"charge\"|\"cargo\" }> }>"
  },
  "getFittingTypeInfoLocal": {
    "parameters": [
      {
        "name": "typeId",
        "optional": false,
        "type": "number"
      }
    ],
    "returns": "Promise<{ typeId:number; name:string; description:string; group:{id:number;name:string}; category:{id:number;name:string}; marketGroup:null|{id:number;name:string;path:string[]}; identity:{factionId?:number;factionName?:string;raceId?:number;raceName?:string}; placement:\"ship\"|\"high\"|\"mid\"|\"low\"|\"rig\"|\"subsystem\"|\"drone\"|\"fighter\"|\"implant\"|\"booster\"|\"charge\"|\"cargo\"; rack?:string; metaLevel?:number; techLevel?:number; published:boolean; iconId?:number; physical:{volumeM3?:number;massKg?:number;capacityM3?:number;radiusM?:number;portionSize?:number;basePrice?:number}; fitting:Array<{attributeId:number;label:string;unit:string;value:number}>; requirements:Array<{skillId:number;name:string;level:number}>; attributes:Array<{attributeId:number;name:string;internalName?:string;description?:string;value:number;unitId?:number;unit?:string;categoryId?:number;category:string;highIsGood?:boolean;published:boolean}>; effects:Array<{effectId:number;name:string;category:number;description?:string}> }>"
  },
  "getHullFittingProfileLocal": {
    "parameters": [
      {
        "name": "typeId",
        "optional": false,
        "type": "number"
      }
    ],
    "returns": "Promise<{ slots:{ high:number; mid:number; low:number; rig:number; subsystem:number }; hardpoints:{ turret:number; launcher:number }; storage:{ cargoM3:number; droneBayM3:number; droneBandwidth:number; fighterHangarM3:number; fighterTubes:number } }>"
  },
  "getMutationOptionsLocal": {
    "parameters": [
      {
        "name": "typeId",
        "optional": false,
        "type": "number"
      }
    ],
    "returns": "Promise<Array<{ mutaplasmidTypeId: number; mutaplasmidName: string; resultingTypeId: number; resultingTypeName: string; attributes: Array<{ attributeId: number; name: string; baseValue: number; minValue: number; maxValue: number; minMultiplier: number; maxMultiplier: number; highIsGood: boolean; unitId?: number }> }>>"
  },
  "checkFittingChargeCompatibilityLocal": {
    "parameters": [
      {
        "name": "moduleTypeId",
        "optional": false,
        "type": "number"
      },
      {
        "name": "chargeTypeId",
        "optional": false,
        "type": "number"
      }
    ],
    "returns": "Promise<{ compatible:boolean; reason:string }>"
  },
  "checkFittingItemCompatibilityLocal": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ hullTypeId:number; itemTypeId:number; placement?:string; fitted?:Array<{typeId:number;rack?:string}> }"
      }
    ],
    "returns": "Promise<{ compatible:boolean; code:string; reason:string }>"
  },
  "getFittingRemediesLocal": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId?:string; hullTypeId:number; issueCodes:string[]; itemTypeIds:number[]; items?:Array<{typeId:number;quantity?:number;rack?:string;chargeTypeId?:number;chargeQuantity?:number;activeQuantity?:number;attributeOverrides?:Record<string,number>;state?:\"offline\"|\"online\"|\"active\"|\"overheated\"}>; implantTypeIds?:number[]; boosterTypeIds?:number[] }"
      }
    ],
    "returns": "Promise<FitRemedyCandidate[]>"
  },
  "resolveTypeIds": {
    "parameters": [
      {
        "name": "ids",
        "optional": false,
        "type": "number[]"
      }
    ],
    "returns": "Promise<Array<{ id: number; name: string }>>"
  },
  "cacheTypeIcons": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ typeIds: number[]; size?: number }"
      }
    ],
    "returns": "Promise<{ requested: number; ready: number; failed: number; size: number }>"
  },
  "listShips": {
    "parameters": [],
    "returns": "Promise<Array<{ typeId: number; name: string; groupId: number; groupName: string; metaGroupId?: number; metaGroupName?: string; factionId?: number; factionName?: string }>>"
  },
  "getManufacturingPlan": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any>"
  },
  "getFoundryWorkspace": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any>"
  },
  "getFoundryMaterialPlan": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any>"
  },
  "getFoundryProjects": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any[]>"
  },
  "searchFoundryBlueprints": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any[]>"
  },
  "createFoundryProject": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any>"
  },
  "updateFoundryProject": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any>"
  },
  "deleteFoundryProject": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any>"
  },
  "getRefineryCatalogue": {
    "parameters": [],
    "returns": "Promise<any>"
  },
  "getRefineryAnalysis": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any>"
  },
  "getReactionCatalogue": {
    "parameters": [],
    "returns": "Promise<any>"
  },
  "getReactionPlan": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any>"
  },
  "getBlueprintActivities": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any>"
  },
  "getInventionOpportunities": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any>"
  },
  "getIndustrySystemCostIndex": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any>"
  },
  "getIndustrialOpportunities": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any>"
  },
  "getPreparedIndustrialCommand": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId: string }"
      }
    ],
    "returns": "Promise<any>"
  },
  "prepareIndustrialCommand": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId: string }"
      }
    ],
    "returns": "Promise<any>"
  },
  "getIndustrialOpportunityRouteScope": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "any"
      }
    ],
    "returns": "Promise<any>"
  },
  "getPreparedIskLab": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId: string; cloneState?: \"alpha\" | \"omega\"; modules?: Array<\"market\" | \"pve\" | \"invention\"> }"
      }
    ],
    "returns": "Promise<{\r\n        market: OpportunityAnalysis | null;\r\n        marketState: { source: \"exact\" | \"last-known-good\"; savedAt: string; sourceRevision: Record<string, string | number | boolean | null> } | null;\r\n        pve: PveLocationAnalysis | null;\r\n        pveState: { source: \"exact\" | \"last-known-good\"; savedAt: string; sourceRevision: Record<string, string | number | boolean | null> } | null;\r\n        invention: any | null;\r\n      }>"
  },
  "getShipReadiness": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{\r\n        characterId: string;\r\n        hullTypeId: number;\r\n        cloneState?: \"alpha\" | \"omega\";\r\n        masteryLevel?: number;\r\n      }"
      }
    ],
    "returns": "Promise<ShipReadinessResult>"
  },
  "getActivityHullPreviews": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId:string; hullTypeIds:number[] }"
      }
    ],
    "returns": "Promise<HullAccessPreview[]>"
  },
  "getActivityReadiness": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{\r\n        characterId: string;\r\n        hullTypeId: number;\r\n        cloneState?: \"alpha\" | \"omega\";\r\n        coreSkills: Array<{ skill: string; level: number }>;\r\n        supportSkills: Array<{ skill: string; level: number }>;\r\n        context: { activityId: string; subcategoryId: string; contentId: string; selectorValues?: Record<string, string> };\r\n        archetypeId?: string;\r\n      }"
      }
    ],
    "returns": "Promise<ActivityReadinessResult>"
  },
  "analyzeFitting": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{\r\n        characterId: string;\r\n        hullTypeId?: number;\r\n        itemTypeIds: number[];\r\n        items?: Array<{ typeId: number; quantity?: number; rack?: string; chargeTypeId?: number; chargeQuantity?: number; activeQuantity?: number; attributeOverrides?: Record<string, number>; state?: \"offline\" | \"online\" | \"active\" | \"overheated\" }>;\r\n        targetProfile?: { rangeM: number; signatureRadiusM: number; transverseVelocityMps: number; velocityMps: number };\r\n        targetTypeId?: number;\r\n        damageProfile?: { em: number; thermal: number; kinetic: number; explosive: number };\r\n        implantTypeIds?: number[];\r\n        boosterTypeIds?: number[];\r\n        boosterSideEffectIds?: number[];\r\n        boosterSideEffectSelections?: Array<{ boosterTypeId:number; effectId:number }>;\r\n        projectedItems?: Array<{ typeId: number; chargeTypeId?: number; attributeOverrides?: Record<string, number>; state?: \"offline\" | \"online\" | \"active\" | \"overheated\"; effectiveness?: number }>;\r\n        commandBurstItems?: Array<{ typeId: number; quantity?: number; chargeTypeId?: number; chargeQuantity?: number; activeQuantity?: number; attributeOverrides?: Record<string, number>; state?: \"offline\" | \"online\" | \"active\" | \"overheated\"; effectiveness?: number }>;\r\n        environmentTypeIds?: number[];\r\n        abyssProfile?: { tier: 0 | 1 | 2 | 3 | 4 | 5 | 6; weather: \"electrical\" | \"exotic\" | \"firestorm\" | \"gamma\" | \"dark\"; penalty?: number; roomKey?: string };\r\n      }"
      }
    ],
    "returns": "Promise<any>"
  },
  "getCapabilities": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{\r\n        characterId: string;\r\n        cloneState?: \"alpha\" | \"omega\";\r\n      }"
      }
    ],
    "returns": "Promise<CapabilityAnalysis>"
  },
  "getCurrentShipCapability": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{\r\n        characterId: string;\r\n        profileId: ShipUseProfileId;\r\n        cloneState?: \"alpha\" | \"omega\";\r\n      }"
      }
    ],
    "returns": "Promise<CapabilityResult>"
  },
  "getConfig": {
    "parameters": [],
    "returns": "Promise<PublicConfig>"
  },
  "saveConfig": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ eveClientId: string }"
      }
    ],
    "returns": "Promise<PublicConfig>"
  },
  "loginWithEve": {
    "parameters": [],
    "returns": "Promise<{\r\n        characterId: string;\r\n        characterName: string;\r\n        snapshot: CharacterSnapshot;\r\n        becamePrimaryIdentity: boolean;\r\n        sageAccountId: string;\r\n        primaryCharacterId: string;\r\n        onlineIdentitySynced: boolean;\r\n        onlineIdentityError?: string;\r\n        reauthorized: boolean;\r\n        scopeManifestVersion: number;\r\n        coverage: { mailPermissionGranted:boolean; mailHeadersCaptured:number; mailBodiesCaptured:number; assetsCaptured:number; walletJournalCaptured:number; walletTransactionsCaptured:number; contractsCaptured:number; corporationDatasets:number };\r\n      }>"
  },
  "refreshCharacter": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<CharacterSnapshot>"
  },
  "refreshCurrentShip": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<CharacterSnapshot>"
  },
  "listSnapshots": {
    "parameters": [],
    "returns": "Promise<CharacterSnapshot[]>"
  },
  "getEveNews": {
    "parameters": [
      {
        "name": "force",
        "optional": true,
        "type": "boolean"
      }
    ],
    "returns": "Promise<EveNewsItem[]>"
  },
  "prepareNavigationGraph": {
    "parameters": [],
    "returns": "Promise<NavigationGraphStatus>"
  },
  "searchNavigationSystems": {
    "parameters": [
      {
        "name": "query",
        "optional": false,
        "type": "string"
      },
      {
        "name": "limit",
        "optional": true,
        "type": "number"
      }
    ],
    "returns": "Promise<NavigationSystem[]>"
  },
  "getNavigationSystem": {
    "parameters": [
      {
        "name": "systemId",
        "optional": false,
        "type": "number"
      }
    ],
    "returns": "Promise<NavigationSystem | null>"
  },
  "getNavigationNeighbours": {
    "parameters": [
      {
        "name": "systemId",
        "optional": false,
        "type": "number"
      }
    ],
    "returns": "Promise<Array<{ edge: NavigationRouteLeg; system: NavigationSystem }>>"
  },
  "getNavigationMapData": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ scope?: \"universe\" | \"region\"; regionId?: number | null }"
      }
    ],
    "returns": "Promise<NavigationMapData>"
  },
  "getNavigationLiveMapMetrics": {
    "parameters": [
      {
        "name": "force",
        "optional": true,
        "type": "boolean"
      }
    ],
    "returns": "Promise<NavigationLiveMapMetrics>"
  },
  "calculateNavigationRoute": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ from: number; to: number; mode?: NavigationRouteMode; minSecurity?: number | null; avoidSystemIds?: number[]; avoidConstellationIds?: number[]; avoidRegionIds?: number[]; excludedSystemIds?: number[] }"
      }
    ],
    "returns": "Promise<NavigationRouteResult>"
  },
  "calculateNavigationPlan": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "NavigationPlanInput"
      }
    ],
    "returns": "Promise<NavigationRoutePlan>"
  },
  "exportNavigationRouteToEve": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId: string; systemIds: number[]; clearOtherWaypoints?: boolean }"
      }
    ],
    "returns": "Promise<{ success: boolean; waypoints: number }>"
  },
  "getNavigationHazards": {
    "parameters": [
      {
        "name": "force",
        "optional": true,
        "type": "boolean"
      }
    ],
    "returns": "Promise<NavigationHazardSnapshot>"
  },
  "getNavigationCharacterLocation": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "forceLive",
        "optional": true,
        "type": "boolean"
      }
    ],
    "returns": "Promise<NavigationCharacterLocation>"
  },
  "getNavigationCapitalContext": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<NavigationCapitalContext>"
  },
  "calculateNavigationCapitalPlan": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId: string; shipTypeId: number; fromSystemId: number; toSystemId: number; startingFatigueMinutes?: number; includeLiveIntelligence?: boolean }"
      }
    ],
    "returns": "Promise<NavigationCapitalPlan>"
  },
  "getNavigationEveWaypointChain": {
    "parameters": [
      {
        "name": "route",
        "optional": false,
        "type": "NavigationRoutePlan"
      }
    ],
    "returns": "Promise<{ systemIds: number[]; complete: boolean; stoppedAtSpecialEdge: string | null; exportedGateLegs: number; totalLegs: number }>"
  },
  "exportNavigationRouteJson": {
    "parameters": [
      {
        "name": "route",
        "optional": false,
        "type": "NavigationRoutePlan"
      }
    ],
    "returns": "Promise<string>"
  },
  "importNavigationRouteJson": {
    "parameters": [
      {
        "name": "text",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<NavigationRoutePlan>"
  },
  "getNavigationOnlineWorkspace": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<NavigationOnlineWorkspace>"
  },
  "listNavigationOnlineRoutes": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId: string; workspaceId: string }"
      }
    ],
    "returns": "Promise<NavigationOnlineRouteSummary[]>"
  },
  "getNavigationOnlineRoute": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId: string; workspaceId: string; objectId: string }"
      }
    ],
    "returns": "Promise<NavigationOnlineRouteObject>"
  },
  "publishNavigationOnlineRoute": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId: string; workspaceId: string; route: NavigationRoutePlan; visibility?: \"workspace\" | \"restricted\"; recipientCharacterIds?: number[] }"
      }
    ],
    "returns": "Promise<{ id: string; object_type: \"sage.route\"; version: number; idempotent_replay?: boolean }>"
  },
  "updateNavigationOnlineRoute": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId: string; workspaceId: string; objectId: string; route: NavigationRoutePlan; expectedVersion: number }"
      }
    ],
    "returns": "Promise<{ id: string; object_type: \"sage.route\"; version: number }>"
  },
  "getNavigationRouteIntelligence": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ systemIds: number[]; legs?: NavigationRouteLeg[] }"
      }
    ],
    "returns": "Promise<NavigationRouteIntelligence>"
  },
  "getWormholeCommandStore": {
    "parameters": [],
    "returns": "Promise<WormholeCommandStore>"
  },
  "exportWormholeSharedChain": {
    "parameters": [],
    "returns": "Promise<WormholeSharedChainPayload>"
  },
  "importWormholeSharedChain": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "WormholeSharedChainPayload"
      }
    ],
    "returns": "Promise<WormholeCommandStore>"
  },
  "mergeWormholeSharedChain": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "WormholeSharedChainPayload"
      }
    ],
    "returns": "Promise<WormholeCommandStore>"
  },
  "getWormholeOnlineWorkspace": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<NavigationOnlineWorkspace>"
  },
  "listWormholeOnlineChains": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;workspaceId:string}"
      }
    ],
    "returns": "Promise<WormholeOnlineChainSummary[]>"
  },
  "getWormholeOnlineChain": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;workspaceId:string;objectId:string}"
      }
    ],
    "returns": "Promise<WormholeOnlineChainObject>"
  },
  "publishWormholeOnlineChain": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;workspaceId:string;chain:WormholeSharedChainPayload;visibility?:\"workspace\"|\"restricted\";recipientCharacterIds?:number[]}"
      }
    ],
    "returns": "Promise<{id:string;object_type:\"sage.wormhole-chain\";version:number;idempotent_replay?:boolean}>"
  },
  "updateWormholeOnlineChain": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;workspaceId:string;objectId:string;chain:WormholeSharedChainPayload;expectedVersion:number}"
      }
    ],
    "returns": "Promise<{id:string;object_type:\"sage.wormhole-chain\";version:number}>"
  },
  "getWormholeOnlineEvents": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;workspaceId:string;after?:number}"
      }
    ],
    "returns": "Promise<WormholeWorkspaceEvent[]>"
  },
  "getWormholeOnlineAudit": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{characterId:string;workspaceId:string}"
      }
    ],
    "returns": "Promise<WormholeOnlineAuditEntry[]>"
  },
  "importLegacyWormholeScans": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "unknown"
      }
    ],
    "returns": "Promise<WormholeCommandStore>"
  },
  "recordWormholeScan": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ systemId:number; systemName:string; characterId:string; characterName:string; scannedAt?:string; signatures:WormholeSignatureObservation[] }"
      }
    ],
    "returns": "Promise<{ store: WormholeCommandStore; reconciliation: WormholeReconciledSignature[] }>"
  },
  "observeWormholeSystem": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ systemId:number; systemName:string; observedAt?:string; characterId?:string; characterName?:string }"
      }
    ],
    "returns": "Promise<WormholeCommandStore>"
  },
  "upsertWormholeWatch": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{watchId?:string;kind:WormholeWatchKind;value?:string;enabled?:boolean}"
      }
    ],
    "returns": "Promise<WormholeCommandStore>"
  },
  "removeWormholeWatch": {
    "parameters": [
      {
        "name": "watchId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<WormholeCommandStore>"
  },
  "recordWormholeWatchAlert": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{watchId:string;fingerprint:string;message:string;systemId?:number;connectionId?:string}"
      }
    ],
    "returns": "Promise<{store:WormholeCommandStore;created:boolean;alert?:WormholeWatchAlert}>"
  },
  "dismissWormholeWatchAlert": {
    "parameters": [
      {
        "name": "alertId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<WormholeCommandStore>"
  },
  "updateWormholeMapLayout": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "Partial<WormholeMapLayout>"
      }
    ],
    "returns": "Promise<WormholeCommandStore>"
  },
  "updateWormholeMapMarkers": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ homeSystemId?:number|null; rallySystemId?:number|null }"
      }
    ],
    "returns": "Promise<WormholeCommandStore>"
  },
  "updateWormholeSignature": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ systemId:number; signatureId:string; siteState?:WormholeSiteState; bookmarkName?:string; editorCharacterId?:string; editorCharacterName?:string }"
      }
    ],
    "returns": "Promise<WormholeCommandStore>"
  },
  "updateWormholeSystem": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ systemId:number; alias?:string; notes?:string; status?:WormholeSystemStatus; pinned?:boolean; editorCharacterId?:string; editorCharacterName?:string }"
      }
    ],
    "returns": "Promise<WormholeCommandStore>"
  },
  "archiveWormholeSystem": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ systemId:number; editorCharacterId?:string; editorCharacterName?:string }"
      }
    ],
    "returns": "Promise<WormholeCommandStore>"
  },
  "previewWormholeCleanup": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ minInactiveHours:number }"
      }
    ],
    "returns": "Promise<WormholeCleanupPreview>"
  },
  "applyWormholeCleanup": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ minInactiveHours:number; systemIds:number[]; editorCharacterId?:string; editorCharacterName?:string }"
      }
    ],
    "returns": "Promise<{store:WormholeCommandStore; archivedSystemIds:number[]; preview:WormholeCleanupPreview}>"
  },
  "upsertWormholeConnection": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "Partial<WormholeConnectionRecord> & { fromSystemId:number; editorCharacterId?:string; editorCharacterName?:string }"
      }
    ],
    "returns": "Promise<{ store: WormholeCommandStore; connection: WormholeConnectionRecord }>"
  },
  "removeWormholeConnection": {
    "parameters": [
      {
        "name": "connectionId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<WormholeCommandStore>"
  },
  "getWormholeReference": {
    "parameters": [],
    "returns": "Promise<WormholeReferenceEntry[]>"
  },
  "getWormholeReferenceEntry": {
    "parameters": [
      {
        "name": "code",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<WormholeReferenceEntry|null>"
  },
  "getWormholeSystemReferences": {
    "parameters": [
      {
        "name": "systemIds",
        "optional": false,
        "type": "number[]"
      }
    ],
    "returns": "Promise<WormholeSystemReferenceEntry[]>"
  },
  "getWormholeRollingShipMass": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ shipTypeId:number; shipName?:string; fittedItems?:Array<{type_id:number;location_flag:string;item?:string}> }"
      }
    ],
    "returns": "Promise<WormholeRollingShipMass>"
  },
  "getNavigationPublicWormholes": {
    "parameters": [
      {
        "name": "force",
        "optional": true,
        "type": "boolean"
      }
    ],
    "returns": "Promise<NavigationPublicWormholeSnapshot>"
  },
  "getWormholeSiteReference": {
    "parameters": [
      {
        "name": "force",
        "optional": true,
        "type": "boolean"
      }
    ],
    "returns": "Promise<WormholePveReferenceSnapshot>"
  },
  "onWormholeCommandUpdated": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(value:WormholeCommandStore)=>void"
      }
    ],
    "returns": "()=>void"
  },
  "refreshSystemIntelligence": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ systemIds: number[]; caller?: \"watch\" | \"route\" | \"single\"; discoverStructures?: boolean; deepKillmailBackfill?: boolean; forceActivity?: boolean }"
      }
    ],
    "returns": "Promise<WormholeSystemIntelligenceRefresh>"
  },
  "onSystemKillmailsUpdated": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(value: { systemIds?: number[]; killmailsBySystem?: Record<string, WormholeKillmailIntel[]>; updatedAtBySystem?: Record<string, string | null>; queuedBySystem?: Record<string, boolean>; status?: any }) => void"
      }
    ],
    "returns": "() => void"
  },
  "removeCharacter": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<CharacterSnapshot[]>"
  },
  "exportData": {
    "parameters": [
      {
        "name": "format",
        "optional": false,
        "type": "\"json\" | \"chatgpt\" | \"chatgpt-radius\""
      },
      {
        "name": "characterId",
        "optional": true,
        "type": "string"
      }
    ],
    "returns": "Promise<string | null>"
  },
  "importData": {
    "parameters": [],
    "returns": "Promise<{\r\n        snapshots: number;\r\n        information: number;\r\n        files: number;\r\n      } | null>"
  },
  "exportDebugLog": {
    "parameters": [],
    "returns": "Promise<string | null>"
  },
  "listMarketRegions": {
    "parameters": [],
    "returns": "Promise<Array<{ regionId: number; name: string }>>"
  },
  "buildFitShoppingRoute": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{\r\n        characterId: string;\r\n        buyEntireFit: boolean;\r\n        highSecOnly?: boolean;\r\n        items: Array<{ typeId?: number; name: string; quantity: number }>;\r\n      }"
      }
    ],
    "returns": "Promise<any>"
  },
  "exportShoppingRouteToEve": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{\r\n        characterId: string;\r\n        stops: Array<{ locationId?: number; systemId: number; station: string; system: string }>;\r\n      }"
      }
    ],
    "returns": "Promise<{ success: boolean; waypoints: number }>"
  },
  "exportFitToEve": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId: string; fit: unknown }"
      }
    ],
    "returns": "Promise<{ fitting_id?: number; success?: boolean }>"
  },
  "findRadiusTrades": {
    "parameters": [
      {
        "name": "mode",
        "optional": false,
        "type": "| \"top\"\r\n          | \"top1000\"\r\n          | \"widened\"\r\n          | \"likely\"\r\n          | \"capital\"\r\n          | \"under10\"\r\n          | \"wallet100m\"\r\n          | \"viator\"\r\n          | \"iskm3\""
      }
    ],
    "returns": "Promise<any>"
  },
  "getOpportunityAnalysis": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{\r\n        characterId?: string;\r\n        maxCapital?: number | null;\r\n        cargoCapacityM3?: number | null;\r\n        cargoProfileId?: string | null;\r\n        maxJumps?: number | null;\r\n        maxMinutes?: number | null;\r\n        force?: boolean;\r\n      }"
      }
    ],
    "returns": "Promise<OpportunityAnalysis>"
  },
  "getPveLocationAnalysis": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{\r\n        characterId: string;\r\n        cloneState?: \"alpha\" | \"omega\";\r\n        maxJumps?: number | null;\r\n        maxMinutes?: number | null;\r\n        forceLive?: boolean;\r\n      }"
      }
    ],
    "returns": "Promise<PveLocationAnalysis>"
  },
  "cancelAnalysis": {
    "parameters": [
      {
        "name": "kind",
        "optional": true,
        "type": "\"opportunity\" | \"capability\" | \"trade\" | \"raw-market\" | \"regional-filter\" | \"pve-location\""
      }
    ],
    "returns": "Promise<boolean>"
  },
  "getAnalysisStatus": {
    "parameters": [],
    "returns": "Promise<any>"
  },
  "runMasterUpdate": {
    "parameters": [
      {
        "name": "input",
        "optional": true,
        "type": "{ cloneStates?: Record<string, \"alpha\" | \"omega\">; characterIds?: string[] }"
      }
    ],
    "returns": "Promise<any>"
  },
  "onPreparedDataUpdated": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(value: { completedAt: string; characterIds?: string[]; preparationFailures?: number; publicDataUpdated?: boolean; publicGeneration?: string; publicArtifacts?: string[]; privateDataReady?: boolean }) => void"
      }
    ],
    "returns": "() => void"
  },
  "onMasterUpdateProgress": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(progress: { running:boolean; stage:string; message:string; percent:number; startedAt?:string; cpuWorkers?:number; downloadDurationMs?:number; totalDurationMs?:number; completed?:number; total?:number; tracks?: Array<{ id:string; label:string; percent:number; status:\"waiting\" | \"running\" | \"done\" | \"error\"; message:string }> }) => void"
      }
    ],
    "returns": "() => void"
  },
  "onAnalysisProgress": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(progress: AnalysisProgress) => void"
      }
    ],
    "returns": "() => void"
  },
  "exportTopArbitrage": {
    "parameters": [],
    "returns": "Promise<string | null>"
  },
  "filterRegionalMarket": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{\r\n        query?: string; categoryIds?: number[]; groupIds?: number[]; marketGroupIds?: number[]; regionIds?: number[]; security?: RegionalMarketFilterSecurity; presence?: RegionalMarketPresence; signal?: RegionalMarketSignal;\r\n        minBestBuy?: number | null; maxBestBuy?: number | null; minBestSell?: number | null; maxBestSell?: number | null; minBuyOrders?: number | null; maxBuyOrders?: number | null; minSellOrders?: number | null; maxSellOrders?: number | null; minBuyVolume?: number | null; minSellVolume?: number | null; maxSellVolume?: number | null;\r\n        minSpreadPercent?: number | null; maxSpreadPercent?: number | null; minRegionalPremiumPercent?: number | null; minDemandSupplyRatio?: number | null; maxItemVolumeM3?: number | null; sort?: RegionalMarketSort; offset?: number; limit?: number;\r\n      }"
      }
    ],
    "returns": "Promise<RegionalMarketFilterResult>"
  },
  "searchOreMarketTypes": {
    "parameters": [
      {
        "name": "query",
        "optional": false,
        "type": "string"
      },
      {
        "name": "limit",
        "optional": true,
        "type": "number"
      },
      {
        "name": "kind",
        "optional": true,
        "type": "\"ore\"|\"ice\"|\"gas\"|\"salvage\""
      }
    ],
    "returns": "Promise<Array<{ typeId:number; name:string; categoryId:number; categoryName:string }>>"
  },
  "syncBuybackContracts": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "Promise<any>"
  },
  "listBuybackRequests": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId:string; status?:string; mine?:boolean }"
      }
    ],
    "returns": "Promise<{requests:any[];can_manage:boolean}>"
  },
  "submitBuybackRequest": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId:string; candidate:any; detectedAt?:string }"
      }
    ],
    "returns": "Promise<any>"
  },
  "setBuybackRequestState": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ characterId:string; requestId:string; status:\"paid\"|\"rejected\"; note?:string }"
      }
    ],
    "returns": "Promise<any>"
  },
  "exportBuybackHistory": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{ format:\"csv\"|\"xlsx\"; rows:any[]; label?:string }"
      }
    ],
    "returns": "Promise<string|null>"
  },
  "quoteMarketDepth": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{\r\n        items?: Array<{ typeId?: number; name?: string; quantity: number }>;\r\n        typeId?: number;\r\n        name?: string;\r\n        quantity?: number;\r\n        regionId?: number;\r\n        locationId?: number;\r\n        side?: \"buy\" | \"sell\";\r\n        fresh?: boolean;\r\n      }"
      }
    ],
    "returns": "Promise<any>"
  },
  "searchRawMarket": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{\r\n        query: string;\r\n        typeId?: number;\r\n        side?: \"all\" | \"buy\" | \"sell\";\r\n        security?: \"all\" | \"high\" | \"low\" | \"null\";\r\n        regionId?: number | null;\r\n        minPrice?: number | null;\r\n        maxPrice?: number | null;\r\n        minVolume?: number | null;\r\n        systemNames?: string[];\r\n        systemQuery?: string;\r\n        locationQuery?: string;\r\n        originSystemId?: number | null;\r\n        maxJumps?: number | null;\r\n        sort?: \"sell-lowest\" | \"buy-highest\" | \"price-low\" | \"price-high\" | \"volume\" | \"newest\" | \"distance\";\r\n        offset?: number;\r\n        limit?: number;\r\n      }"
      }
    ],
    "returns": "Promise<RawMarketSearchResult>"
  },
  "listMarketSummaries": {
    "parameters": [],
    "returns": "Promise<MarketSummary[]>"
  },
  "getMarketRegion": {
    "parameters": [
      {
        "name": "regionId",
        "optional": false,
        "type": "number"
      }
    ],
    "returns": "Promise<MarketSummary | null>"
  },
  "getPublicDataStatus": {
    "parameters": [],
    "returns": "Promise<PublicDataStatus>"
  },
  "checkPublicDataAvailability": {
    "parameters": [],
    "returns": "Promise<PublicDataStatus>"
  },
  "checkPublicData": {
    "parameters": [],
    "returns": "Promise<PublicDataStatus & { changed: boolean; changedArtifacts: string[] }>"
  },
  "refreshServerContracts": {
    "parameters": [],
    "returns": "Promise<{ changed: boolean; snapshotId: string; createdAt: string; contractCount: number; pendingDetailCount: number }>"
  },
  "onPublicDataStatus": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(value: PublicDataStatus) => void"
      }
    ],
    "returns": "() => void"
  },
  "onPublicDataProgress": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(value: { running: boolean; percent: number; message: string; completed?: number; total?: number; error?: string }) => void"
      }
    ],
    "returns": "() => void"
  },
  "getMarketStorage": {
    "parameters": [],
    "returns": "Promise<{\r\n        path: string;\r\n        retainedDatasets: number;\r\n        raw?: { root: string; snapshotId: string; createdAt: string; orderCount: number; regionCount: number; complete: boolean } | null;\r\n      }>"
  },
  "pullMarket": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "{\r\n        mode: \"single\" | \"all\" | \"radius\" | \"contracts\";\r\n        regionId?: number;\r\n        characterId?: string;\r\n        includeLowSec?: boolean;\r\n      }"
      }
    ],
    "returns": "Promise<{\r\n        summaries: MarketSummary[];\r\n        storage: {\r\n          path: string;\r\n          retained: number;\r\n          raw?: { root: string; snapshotId: string; orderCount: number; regionCount: number } | null;\r\n        };\r\n      }>"
  },
  "onMarketProgress": {
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(progress: {\r\n          mode: \"single\" | \"all\" | \"radius\" | \"contracts\";\r\n          regionName: string;\r\n          regionsDone: number;\r\n          regionsTotal: number;\r\n          pagesDone: number;\r\n          pagesTotal: number;\r\n        }) => void"
      }
    ],
    "returns": "() => void"
  },
  "getStrategicCommandStatus": {
    "parameters": [],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "askStrategicCommand": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "unknown"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "findCorporationHomes": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "unknown"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "scanCorporationHomeCandidate": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "unknown"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "getCorporationHrState": {
    "parameters": [
      {
        "name": "characterId",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "createCorporationHrRequest": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "unknown"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "revokeCorporationHrRequest": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "unknown"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "resolveCorporationHrCode": {
    "parameters": [
      {
        "name": "code",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "submitCorporationHrSnapshot": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "unknown"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "withdrawCorporationHrRequest": {
    "parameters": [
      {
        "name": "code",
        "optional": false,
        "type": "string"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "addCorporationHrNote": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "unknown"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "setCorporationHrDecision": {
    "parameters": [
      {
        "name": "input",
        "optional": false,
        "type": "unknown"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "searchLootItems": {
    "parameters": [
      {
        "name": "query",
        "optional": false,
        "type": "string"
      },
      {
        "name": "limit",
        "optional": true
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "getLootAcquisition": {
    "parameters": [
      {
        "name": "typeId",
        "optional": false,
        "type": "number"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "prepareLootDataLocal": {
    "parameters": [],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "searchSolarSystems": {
    "parameters": [
      {
        "name": "query",
        "optional": false,
        "type": "string"
      },
      {
        "name": "limit",
        "optional": true
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "getSystemIntelligence": {
    "parameters": [
      {
        "name": "systemId",
        "optional": false,
        "type": "number"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "refreshWatchedSystemIntelligence": {
    "parameters": [
      {
        "name": "systemIds",
        "optional": false,
        "type": "number[]"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "getMarketItemHistory": {
    "parameters": [
      {
        "name": "typeId",
        "optional": false,
        "type": "number"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  },
  "exportRegionalMarket": {
    "parameters": [
      {
        "name": "format",
        "optional": false,
        "type": "\"csv\" | \"json\" | \"xlsx\""
      },
      {
        "name": "rows",
        "optional": false,
        "type": "unknown[]"
      },
      {
        "name": "itemName",
        "optional": true,
        "type": "string"
      }
    ],
    "returns": "IPC result (not declared in renderer type interface)"
  }
};
