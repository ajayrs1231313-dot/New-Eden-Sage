// Abyss encounter catalogue for the fitting engine.
// Room provenance: EVE University, "Possible rooms in Abyssal Deadspace" (last edited 2026-01-16),
// cross-checked against recent Abyssal.Space telemetry. CCP's SDE is authoritative for the stable type IDs below.
// The public room source explicitly documents variable/interchangeable spawns. We preserve those as min/max
// ranges and alternative type IDs, and calculations use a clearly labelled documented upper-bound envelope.

export type AbyssTier = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type AbyssWeather = "electrical" | "exotic" | "firestorm" | "gamma" | "dark";
export type AbyssPenalty = 0.3 | 0.5 | 0.7;
export type AbyssFamily = "edencom" | "rogue-drone" | "sleeper-drifter" | "triglavian" | "angel" | "sansha";

export type AbyssEncounterMember = {
  typeIds: number[];
  minCount: number;
  maxCount: number;
  label?: string;
  requiredForClear?: boolean;
};

export type AbyssEncounterDefinition = {
  key: string;
  name: string;
  family: AbyssFamily;
  tiers: AbyssTier[];
  members: AbyssEncounterMember[];
  notes?: string;
  maxHostiles?: number;
};

const m = (typeIds: number | number[], minCount: number, maxCount = minCount, label?: string, requiredForClear = true): AbyssEncounterMember => ({
  typeIds: Array.isArray(typeIds) ? typeIds : [typeIds], minCount, maxCount, label, requiredForClear,
});
const room = (tier: AbyssTier, key: string, name: string, family: AbyssFamily, members: AbyssEncounterMember[], notes?: string, maxHostiles?: number): AbyssEncounterDefinition => ({ key: `t${tier}-${key}`, name, family, tiers: [tier], members, notes, maxHostiles });

// Stable CCP SDE type IDs used by the documented room catalogue.
const T = {
  skybreaker: 56188, attackerPacifier: 56170, markerPacifier: 56172, arresterPacifier: 56171,
  attackerMarshal: 56176, arresterMarshal: 56177, drainerMarshal: 56178, assaultEnforcer: 56174,
  drainerEnforcer: 56175, thunderchild: 56200, stormbringer: 56189,
  sparkneedle: 47847, emberneedle: 47848, strikeneedle: 47849, blastneedle: 47855,
  sparklance: 47856, emberlance: 47857, strikelance: 47858, blastlance: 47859,
  fieldweaver: 47850, snarecaster: 47851, fogcaster: 47852, gazedimmer: 47853, spotlighter: 47854, plateforger: 47860,
  sparkgrip: 48262, embergrip: 48263, strikegrip: 48264, blastgrip: 48265,
  photic: 47876, twilit: 47877, bathyic: 47878, hadal: 47879, benthic: 47880, endobenthic: 56213,
  luciferCynabal: 56295, eliteLuciferCynabal: 56315, luciferDramiel: 56346, eliteLuciferDramiel: 56347,
  luciferFury: 56348, luciferEcho: 56349, luciferMedusa: 56350, luciferBurst: 56351, luciferSwordspine: 56352, luciferIxion: 56316,
  lucidEscort: 48241, lucidAegis: 48245, lucidFirewatcher: 48247, lucidWatchman: 48248, lucidUpholder: 48249,
  lucidSentinel: 48250, lucidPreserver: 48251, lucidDeepwatcher: 48252, lucidWarden: 48246,
  ephLancer: 48234, ephEntangler: 48235, ephSpearfisher: 48236, ephIlluminator: 48237, ephDissipator: 48238, ephObfuscator: 48239, ephConfuser: 48240,
  drifterFoothold: 47953, drifterRearguard: 47954, drifterFrontline: 47955, drifterVanguard: 47956, drifterAssault: 47957,
  drifterEntanglement: 47958, drifterNullwarp: 47959, drifterNullcharge: 47960, drifterCommand: 56214,
  strikingDamavik: 48092, anchoringDamavik: 48089, ghostingDamavik: 48086, starvingDamavik: 48090, tanglingDamavik: 48088,
  harrowingVedmak: 48091, starvingVedmak: 48087,
  strikingKikimora: 56150, ghostingKikimora: 56151, tanglingKikimora: 56152,
  strikingDrekavac: 56160, shiningDrekavac: 56161, renewingRodiva: 56159,
  strikingLeshak: 48122, renewingLeshak: 48123, tanglingLeshak: 48124, starvingLeshak: 48125, wardingLeshak: 48126, blindingLeshak: 48127,
  strikingVila: 48256, anchoringVila: 48258, ghostingVila: 48261, blindingVila: 48260, shiningVila: 48259, tanglingVila: 48257, harrowingVila: 48255, vilaSwarmer: 48253,
  devotedHunter: 56138, devotedKnight: 56148, devotedTrapper: 56164, devotedTorchbearer: 56168, devotedSmith: 56165, devotedHerald: 56167, devotedPriest: 56163, devotedFisher: 56162, devotedLookout: 56166,
} as const;

const needles = [T.sparkneedle, T.emberneedle, T.strikeneedle, T.blastneedle];
const lances = [T.sparklance, T.emberlance, T.strikelance, T.blastlance];
const luciferFrigates = [T.luciferDramiel, T.eliteLuciferDramiel, T.luciferFury, T.luciferEcho, T.luciferMedusa, T.luciferBurst, T.luciferSwordspine];
const luciferT1Frigates = [T.luciferDramiel, T.luciferFury, T.luciferEcho, T.luciferMedusa, T.luciferSwordspine];
const lucidFrigates = [T.lucidEscort, T.lucidAegis, T.lucidFirewatcher, T.lucidWarden, T.lucidPreserver];
const lucidT1Frigates = [T.lucidEscort, T.lucidAegis, T.lucidFirewatcher, T.lucidWarden];
const lucidCruisers = [T.lucidWatchman, T.lucidUpholder, T.lucidSentinel];
const ephCruisers = [T.ephLancer, T.ephEntangler, T.ephSpearfisher, T.ephIlluminator, T.ephDissipator, T.ephObfuscator, T.ephConfuser];
const ephT1Cruisers = [T.ephLancer, T.ephIlluminator, T.ephSpearfisher];
const drifterCruisers = [T.drifterEntanglement, T.drifterNullwarp, T.drifterNullcharge];
const devotedFrigates = [T.devotedHunter, T.devotedTrapper, T.devotedTorchbearer, T.devotedSmith, T.devotedHerald, T.devotedPriest, T.devotedFisher, T.devotedLookout];

export const ABYSS_ENCOUNTERS: AbyssEncounterDefinition[] = [
  // T0
  room(0,"edencom-skybreaker","Skybreaker patrol","edencom",[m(T.skybreaker,1)]),
  room(0,"edencom-pacifier","Pacifier patrol","edencom",[m(T.attackerPacifier,1)]),
  room(0,"drone-needles","Needle swarm","rogue-drone",[m(needles,2,3,"Needle Tessella")]),
  room(0,"drone-needle-lance","Needle + Lance","rogue-drone",[m(needles,1,1,"Needle Tessella"),m(lances,1,1,"Lance Tessella")]),
  room(0,"angel-fury","Lucifer Fury","angel",[m(T.luciferFury,1)]),
  room(0,"angel-echo","Lucifer Echo","angel",[m(T.luciferEcho,1)]),
  room(0,"angel-swordspine","Lucifer Swordspine","angel",[m(T.luciferSwordspine,1)]),
  room(0,"angel-medusa","Lucifer Medusa","angel",[m(T.luciferMedusa,1)]),
  room(0,"angel-dramiel","Lucifer Dramiel","angel",[m(T.luciferDramiel,1)]),
  room(0,"sleeper-frigate","Lucid frigate","sleeper-drifter",[m([T.lucidEscort,T.lucidAegis],1)]),
  room(0,"sleeper-lancer","Ephialtes Lancer","sleeper-drifter",[m(T.ephLancer,1)]),
  room(0,"trig-damavik","Striking Damavik","triglavian",[m(T.strikingDamavik,1)]),
  room(0,"trig-vila","Striking Vila Damavik","triglavian",[m(T.strikingVila,1)]),
  room(0,"sansha-hunter","Devoted Hunter","sansha",[m(T.devotedHunter,1)]),

  // T1
  room(1,"edencom-pack","EDENCOM frigate pack","edencom",[m(T.skybreaker,0,2),m([T.attackerPacifier,T.markerPacifier],0,3)],"Source documents 2-3 total ships; Sage selects the documented threat envelope within that cap.",3),
  room(1,"edencom-marshal","Attacker Marshal","edencom",[m(T.attackerMarshal,1)]),
  room(1,"drone-grip","Tessera battlecruiser","rogue-drone",[m([T.sparkgrip,T.embergrip,T.strikegrip,T.blastgrip],1)]),
  room(1,"drone-swarm","Needle/Lance swarm","rogue-drone",[m(needles,3,6),m(lances,0,3),m(T.strikingDamavik,0,1)]),
  room(1,"overmind","Photic Overmind","rogue-drone",[m(T.photic,1),m(needles,1,2)]),
  room(1,"angel-frigates","Lucifer frigate trio","angel",[m(luciferT1Frigates,3)]),
  room(1,"angel-cynabal","Lucifer Cynabal escort","angel",[m(T.luciferCynabal,1),m(luciferFrigates,1)]),
  room(1,"angel-ixion","Lucifer Ixion escort","angel",[m(T.luciferIxion,1),m(luciferFrigates,1)]),
  room(1,"sleeper-mixed","Lucid/Ephialtes mixed","sleeper-drifter",[m(lucidT1Frigates,0,3),m(ephT1Cruisers,0,3)],"Source caps the room at three enemies.",3),
  room(1,"sleeper-cruiser","Lucid cruiser escort","sleeper-drifter",[m(lucidCruisers,1),m(lucidT1Frigates,0,1),m(ephT1Cruisers,0,1),m(drifterCruisers,0,1)],"Source caps the room at two enemies.",2),
  room(1,"drifter-foothold","Drifter foothold","sleeper-drifter",[m(T.drifterFoothold,0,1),m(T.ephLancer,0,1),m(drifterCruisers,0,1)],"Legacy source names the battleship Karybdis and cruiser Scylla; mapped to current CCP tier-role entities. Source caps the room at two enemies.",2),
  room(1,"deepwatcher","Lucid Deepwatcher","sleeper-drifter",[m(T.lucidDeepwatcher,1)]),
  room(1,"kikimora","Kikimora + Damavik","triglavian",[m(T.strikingKikimora,1),m(T.strikingDamavik,1)]),
  room(1,"damavik-pack","Damavik pack","triglavian",[m([T.strikingDamavik,T.anchoringDamavik,T.ghostingDamavik],3)]),
  room(1,"vila-pack","Vila Damaviks","triglavian",[m([T.strikingVila,T.anchoringVila,T.shiningVila],2)]),
  room(1,"drekavac","Drekavac","triglavian",[m([T.strikingDrekavac,T.shiningDrekavac],1)]),
  room(1,"leshak","Leshak","triglavian",[m([T.strikingLeshak,T.blindingLeshak],1),m(needles,0,1)]),
  room(1,"sansha-frigates","Devoted frigate trio","sansha",[m([T.devotedHunter,T.devotedTrapper,T.devotedTorchbearer],3)]),
  room(1,"sansha-knight","Devoted Knight","sansha",[m(T.devotedKnight,1)]),

  // T2
  room(2,"edencom-mixed","EDENCOM mixed formation","edencom",[m(T.arresterMarshal,0,1),m(T.thunderchild,0,1),m(T.drainerEnforcer,0,1),m(T.stormbringer,0,1),m(T.skybreaker,0,3)]),
  room(2,"drone-needle-wall","Needle wall","rogue-drone",[m(T.blastneedle,5),m(T.sparkneedle,3),m(T.fogcaster,3)]),
  room(2,"drone-grips","Grip + EWAR","rogue-drone",[m(T.embergrip,1),m(T.blastgrip,1),m(T.snarecaster,0,3),m([T.fieldweaver,T.plateforger],0,2)]),
  room(2,"overmind","Twilit Overmind","rogue-drone",[m(T.twilit,1),m(T.gazedimmer,2,3)]),
  room(2,"angel-mixed","Lucifer mixed formation","angel",[m(T.luciferIxion,0,1),m(T.luciferCynabal,0,2),m(T.eliteLuciferCynabal,0,1),m(luciferFrigates,0,6)]),
  room(2,"sleeper-lancers","Ephialtes Lancer/Dissipator","sleeper-drifter",[m(T.ephLancer,2),m(T.ephDissipator,4)]),
  room(2,"sleeper-frigates","Lucid frigate formation","sleeper-drifter",[m(T.lucidEscort,2),m(T.lucidWarden,3),m(T.lucidFirewatcher,1)]),
  room(2,"deepwatcher","Deepwatcher escort","sleeper-drifter",[m(T.lucidDeepwatcher,1),m(T.ephObfuscator,1),m(T.lucidEscort,2)]),
  room(2,"drifter-cruisers","Drifter cruiser cell","sleeper-drifter",[m(T.lucidWatchman,1),m(T.lucidSentinel,1),m(drifterCruisers,2)]),
  room(2,"drifter-rearguard","Drifter Rearguard","sleeper-drifter",[m(T.drifterRearguard,1),m(T.ephObfuscator,2)]),
  room(2,"ewar-cell","Ephialtes/Lucid EWAR cell","sleeper-drifter",[m(T.ephEntangler,2),m(T.lucidAegis,3),m(T.lucidPreserver,1)]),
  room(2,"drekavac","Drekavac pair","triglavian",[m(T.shiningDrekavac,2),m(T.strikingDamavik,1)]),
  room(2,"kikimora-rod","Kikimora + Rodiva","triglavian",[m(T.strikingKikimora,1),m(T.renewingRodiva,1)]),
  room(2,"trig-line","Damavik/Kikimora/Drekavac","triglavian",[m(T.strikingDamavik,1),m(T.strikingKikimora,1),m(T.strikingDrekavac,1)]),
  room(2,"leshak-pair","Leshak pair","triglavian",[m(T.strikingLeshak,1),m(T.tanglingLeshak,1)]),
  room(2,"vedmak","Vedmak escort","triglavian",[m(T.harrowingVedmak,1),m(T.strikingDamavik,1),m(T.tanglingDamavik,1)]),
  room(2,"vila","Vila swarm","triglavian",[m(T.strikingVila,2),m(T.tanglingVila,2),m(T.vilaSwarmer,12,12,"Vila Swarmer",false)]),
  room(2,"kiki-pack","Kikimora pack","triglavian",[m(T.strikingDamavik,1),m(T.starvingDamavik,2),m(T.strikingKikimora,3)]),

  // T3
  room(3,"edencom-mixed","EDENCOM heavy formation","edencom",[m(T.attackerMarshal,0,3),m(T.thunderchild,0,2),m(T.drainerEnforcer,0,2),m(T.markerPacifier,0,3)]),
  room(3,"drone-lances","Lance/EWAR swarm","rogue-drone",[m(T.emberlance,3),m(T.strikelance,4),m(T.fieldweaver,2),m(T.spotlighter,2)]),
  room(3,"overmind","Bathyic Overmind","rogue-drone",[m(T.bathyic,1),m(T.blastneedle,2),m(T.gazedimmer,1),m(T.fogcaster,1,2)]),
  room(3,"drone-rodiva","Lance + Rodiva","rogue-drone",[m(T.emberlance,5),m(T.fogcaster,2),m(T.gazedimmer,2),m(T.renewingRodiva,1,3)]),
  room(3,"drone-grips","Tessera formation","rogue-drone",[m(T.sparkgrip,1,2),m(T.strikegrip,1),m(T.embergrip,1),m(T.plateforger,2),m(T.snarecaster,3)]),
  room(3,"angel-mixed","Lucifer heavy formation","angel",[m(T.luciferIxion,0,2),m(T.luciferCynabal,0,3),m(T.eliteLuciferCynabal,0,2),m(luciferFrigates,3,6)]),
  room(3,"deepwatchers","Double Deepwatcher","sleeper-drifter",[m(T.lucidDeepwatcher,2),m(T.ephLancer,0,1),m([T.lucidEscort,T.lucidAegis],0,1)]),
  room(3,"sleeper-swarm","Sleeper cruiser/frigate swarm","sleeper-drifter",[m(T.lucidUpholder,0,2),m(T.lucidFirewatcher,1,6),m([T.lucidEscort,T.lucidAegis],2),m(T.lucidWarden,1)]),
  room(3,"drifter-frontline","Drifter Frontline","sleeper-drifter",[m(T.drifterFrontline,1),m(ephCruisers,0,4),m(drifterCruisers,0,4)]),
  room(3,"ewar-cruisers","Cruiser EWAR wall","sleeper-drifter",[m(T.ephLancer,2),m(drifterCruisers,1),m(T.ephConfuser,4),m(T.ephIlluminator,2)]),
  room(3,"drek-kiki","Drekavac/Kikimora formation","triglavian",[m(T.strikingDamavik,1,2),m(T.ghostingKikimora,1,2),m(T.strikingDrekavac,0,3)],"Drekavac branch of the documented mutually-exclusive Drekavac/Rodiva variant."),
  room(3,"rodiva-kiki","Rodiva/Kikimora formation","triglavian",[m(T.strikingDamavik,1,2),m(T.ghostingKikimora,1,2),m(T.renewingRodiva,0,2)],"Rodiva branch of the documented mutually-exclusive Drekavac/Rodiva variant."),
  room(3,"leshak","Leshak formation","triglavian",[m(T.strikingLeshak,2,3),m(T.renewingLeshak,1),m(T.gazedimmer,0,3)]),
  room(3,"vedmak","Vedmak pressure","triglavian",[m(T.harrowingVedmak,1),m(T.starvingVedmak,1),m(T.ghostingDamavik,2),m(T.strikingDamavik,1)]),
  room(3,"vila","Vila swarm","triglavian",[m(T.harrowingVila,1),m(T.strikingVila,1),m(T.anchoringVila,3),m(T.vilaSwarmer,16,16,"Vila Swarmer",false)]),
  room(3,"sansha","Devoted formation","sansha",[m(T.devotedKnight,0,3),m(devotedFrigates,1,10)]),

  // T4
  room(4,"edencom","EDENCOM T4 formation","edencom",[m(T.markerPacifier,2),m(T.assaultEnforcer,0,4),m(T.thunderchild,0,4),m(T.arresterMarshal,0,5)]),
  room(4,"overmind","Hadal Overmind","rogue-drone",[m(T.hadal,1),m(T.spotlighter,2),m(T.fogcaster,2),m(T.fieldweaver,2),m(T.emberneedle,1)]),
  room(4,"drone-swarm","Blastlance swarm","rogue-drone",[m(T.blastlance,10),m(T.snarecaster,2),m(T.spotlighter,3)]),
  room(4,"drone-grips","Heavy Tessera formation","rogue-drone",[m(T.strikegrip,2),m(T.sparkgrip,1),m(T.embergrip,2),m([T.fieldweaver,T.plateforger],0,6),m(T.snarecaster,0,5)]),
  room(4,"angel","Lucifer T4 formation","angel",[m(T.luciferIxion,0,2),m(T.luciferCynabal,0,5),m(T.eliteLuciferCynabal,0,5),m(luciferFrigates,3,6)]),
  room(4,"deepwatcher","Deepwatcher T4 escort","sleeper-drifter",[m(T.lucidDeepwatcher,2),m(T.ephDissipator,1,3),m(T.lucidFirewatcher,1),m(T.lucidAegis,3)]),
  room(4,"drifter-vanguard","Drifter Vanguard","sleeper-drifter",[m(T.drifterVanguard,1),m(drifterCruisers,3),m(ephCruisers,2),m(drifterCruisers,2,2,"Additional Drifter cruiser")]),
  room(4,"sleeper-variable","Sleeper variable formation","sleeper-drifter",[m(lucidCruisers,0,7),m(drifterCruisers,0,4),m(ephCruisers,0,4),m(lucidFrigates,0,15)]),
  room(4,"vedmak","Vedmak/Damavik pressure","triglavian",[m([T.harrowingVedmak,T.starvingVedmak],0,4),m(T.anchoringDamavik,0,12)]),
  room(4,"leshak","Leshak wall","triglavian",[m(T.strikingLeshak,1),m(T.blindingLeshak,2),m(T.starvingLeshak,2),m(T.snarecaster,1)]),
  room(4,"vila","Vila T4 swarm","triglavian",[m(T.harrowingVila,0,4),m(T.shiningVila,1),m(T.ghostingVila,3),m(T.anchoringVila,1),m(T.vilaSwarmer,23,23,"Vila Swarmer",false)]),
  room(4,"drekavac","Drekavac/Kikimora formation","triglavian",[m([T.strikingDrekavac,T.shiningDrekavac],0,4),m(T.renewingRodiva,0,3),m([T.strikingKikimora,T.ghostingKikimora,T.tanglingKikimora],1,8),m(T.anchoringDamavik,0,12)]),
  room(4,"sansha","Devoted T4 formation","sansha",[m(T.devotedKnight,0,4),m(devotedFrigates,1,10)]),

  // T5 - all documented non-empty room rows in the source.
  room(5,"edencom","EDENCOM heavy room","edencom",[m(T.markerPacifier,2),m(T.assaultEnforcer,2),m(T.thunderchild,1),m(T.arresterMarshal,2),m(T.drainerMarshal,1)]),
  room(5,"overmind","Benthic Overmind","rogue-drone",[m(T.benthic,1),m(T.snarecaster,4),m(T.fogcaster,3),m(T.fieldweaver,4),m(T.spotlighter,2)]),
  room(5,"drone-grips","Tessera battlecruiser wall","rogue-drone",[m(T.embergrip,2),m(T.blastgrip,1),m(T.sparkgrip,3),m(T.plateforger,4),m(T.snarecaster,2)]),
  room(5,"drone-lances","Lance/EWAR swarm","rogue-drone",[m(T.emberlance,4,5),m(T.blastlance,1,2),m(T.spotlighter,2),m(T.gazedimmer,3,4)]),
  room(5,"sleeper-cruisers","Sleeper/Drifter cruiser wall","sleeper-drifter",[m(drifterCruisers,4,4,"Legacy Scylla slot"),m(T.ephSpearfisher,3),m(T.lucidWatchman,2),m(T.ephLancer,2),m(T.lucidUpholder,3)]),
  room(5,"drifter-assault","Drifter Assault room","sleeper-drifter",[m(T.drifterAssault,1),m(T.ephDissipator,3),m(drifterCruisers,3,3,"Legacy Scylla slots"),m(T.ephEntangler,3),m(T.ephIlluminator,2)]),
  room(5,"deepwatchers","Triple Deepwatcher","sleeper-drifter",[m(T.lucidDeepwatcher,3),m(T.lucidEscort,0,1)]),
  room(5,"vedmak","Vedmak pressure","triglavian",[m(T.harrowingVedmak,1),m(T.starvingVedmak,2),m(T.starvingDamavik,3),m(T.tanglingDamavik,1)]),
  room(5,"leshak","Leshak wall","triglavian",[m(T.tanglingLeshak,1),m(T.wardingLeshak,1),m(T.renewingLeshak,4),m(T.plateforger,3),m(T.spotlighter,4)]),
  room(5,"vila","Vila swarm","triglavian",[m(T.harrowingVila,3),m(T.ghostingVila,2),m(T.anchoringVila,3),m(T.strikingVila,1),m(T.vilaSwarmer,30,30,"Vila Swarmer",false)]),
  room(5,"drekavac","Drekavac strike room","triglavian",[m(T.tanglingDamavik,3),m(T.strikingKikimora,1),m(T.strikingDrekavac,5)]),

  // T6 — EVE University's public table currently documents the first two rows below. The remaining rows are
  // exact, distinct compositions observed in current Abyssal.Space T6 run telemetry. They are intentionally
  // NOT merged into inferred min/max family envelopes: one observed composition proves that composition exists,
  // but does not prove a family-wide maximum. This expands useful high-tier coverage without inventing super rooms.
  room(6,"overmind","Endobenthic Overmind","rogue-drone",[m(T.spotlighter,2),m(T.gazedimmer,1),m(T.snarecaster,3),m(T.fogcaster,1),m(T.endobenthic,1)],"Documented T6 row from the EVE University room table."),
  room(6,"vedmak","Vedmak pressure","triglavian",[m(T.harrowingVedmak,5),m(T.strikingDamavik,3),m(T.tanglingDamavik,1),m(T.starvingDamavik,2)],"Documented T6 row from the EVE University room table."),

  room(6,"observed-drone-grips","Observed Tessera battlecruiser wall","rogue-drone",[
    m(T.blastgrip,1),m(T.embergrip,2),m(T.fieldweaver,4),m(T.sparkgrip,3),m(T.strikegrip,2),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-drone-lances-rodiva","Observed Lance / Rodiva swarm","rogue-drone",[
    m(T.blastlance,4),m(T.emberlance,2),m(T.gazedimmer,1),m(T.renewingRodiva,2),m(T.sparklance,4),m(T.spotlighter,2),m(T.strikelance,7),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-trig-mixed","Observed Vedmak / Damavik / Needle pressure","triglavian",[
    m(T.anchoringDamavik,6),m(T.harrowingVedmak,1),m(T.sparkneedle,3),m(T.starvingDamavik,2),m(T.starvingVedmak,1),m(T.strikeneedle,5),m(T.strikingDamavik,1),m(T.tanglingDamavik,3),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-kikimora-damavik","Observed Kikimora / Damavik wall","triglavian",[
    m(T.anchoringDamavik,2),m(T.ghostingKikimora,5),m(T.starvingDamavik,3),m(T.strikingDamavik,1),m(T.strikingKikimora,3),m(T.tanglingKikimora,4),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-vedmak-simple","Observed Starving Vedmak cell","triglavian",[
    m(T.ghostingDamavik,1),m(T.starvingVedmak,6),m(T.tanglingDamavik,1),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-vedmak-mixed","Observed mixed Vedmak pressure","triglavian",[
    m(T.anchoringDamavik,1),m(T.harrowingVedmak,3),m(T.starvingDamavik,2),m(T.starvingVedmak,2),m(T.strikingDamavik,2),m(T.tanglingDamavik,2),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-leshak","Observed Leshak wall","triglavian",[
    m(T.blindingLeshak,1),m(T.renewingLeshak,1),m(T.sparkneedle,1),m(T.starvingLeshak,2),m(T.strikingLeshak,2),m(T.tanglingLeshak,3),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-vila-a","Observed Vila swarm A","triglavian",[
    m(T.anchoringVila,1),m(T.ghostingVila,4),m(T.harrowingVila,2),m(T.shiningVila,7),m(T.tanglingVila,3),
  ],"Exact live T6 spawn-list composition observed in Abyssal.Space telemetry. Linked Vila Swarmer counts are not inferred when the spawn list does not expose them."),
  room(6,"observed-vila-b","Observed Vila swarm B","triglavian",[
    m(T.anchoringVila,2),m(T.blindingVila,3),m(T.harrowingVila,3),m(T.shiningVila,2),m(T.strikingVila,3),m(T.tanglingVila,1),
  ],"Exact live T6 spawn-list composition observed in Abyssal.Space telemetry. Linked Vila Swarmer counts are not inferred when the spawn list does not expose them."),

  room(6,"observed-sleeper-drifter","Observed Sleeper / Drifter cruiser wall","sleeper-drifter",[
    m(T.drifterEntanglement,1),m(T.drifterNullcharge,1),m(T.ephDissipator,5),m(T.ephEntangler,8),m(T.ephObfuscator,5),m(T.ephSpearfisher,4),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-sleeper-lucid-a","Observed Lucid / Ephialtes formation A","sleeper-drifter",[
    m(T.ephConfuser,5),m(T.ephEntangler,5),m(T.ephLancer,3),m(T.ephObfuscator,3),m(T.lucidAegis,2),m(T.lucidEscort,2),m(T.lucidFirewatcher,4),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-sleeper-lucid-b","Observed Lucid / Ephialtes formation B","sleeper-drifter",[
    m(T.ephConfuser,3),m(T.ephDissipator,1),m(T.ephEntangler,4),m(T.ephLancer,2),m(T.ephObfuscator,4),m(T.lucidAegis,2),m(T.lucidEscort,2),m(T.lucidFirewatcher,2),m(T.lucidWarden,4),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-lucid","Observed Lucid formation","sleeper-drifter",[
    m(T.lucidAegis,1),m(T.lucidEscort,3),m(T.lucidFirewatcher,4),m(T.lucidPreserver,2),m(T.lucidSentinel,1),m(T.lucidUpholder,1),m(T.lucidWarden,7),m(T.lucidWatchman,1),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-drifter-command-a","Observed Drifter Command formation A","sleeper-drifter",[
    m(T.drifterCommand,1),m(T.drifterEntanglement,3),m(T.drifterNullcharge,2),m(T.drifterNullwarp,4),m(T.ephLancer,3),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-drifter-command-b","Observed Drifter Command formation B","sleeper-drifter",[
    m(T.drifterCommand,1),m(T.ephDissipator,1),m(T.ephEntangler,4),m(T.ephIlluminator,8),m(T.ephSpearfisher,3),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),

  room(6,"observed-sansha","Observed Devoted Sansha formation","sansha",[
    m(T.devotedHerald,4),m(T.devotedKnight,2),m(T.devotedLookout,4),m(T.devotedPriest,6),m(T.devotedTorchbearer,4),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-angel-a","Observed Lucifer formation A","angel",[
    m(T.eliteLuciferCynabal,3),m(T.eliteLuciferDramiel,1),m(T.luciferCynabal,4),m(T.luciferDramiel,1),m(T.luciferEcho,1),m(T.luciferFury,2),m(T.luciferMedusa,1),m(T.luciferSwordspine,2),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-angel-b","Observed Lucifer formation B","angel",[
    m(T.eliteLuciferCynabal,3),m(T.eliteLuciferDramiel,2),m(T.luciferCynabal,3),m(T.luciferFury,2),m(T.luciferIxion,1),m(T.luciferMedusa,2),m(T.luciferSwordspine,2),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
  room(6,"observed-angel-c","Observed Lucifer formation C","angel",[
    m(T.eliteLuciferCynabal,1),m(T.eliteLuciferDramiel,4),m(T.luciferBurst,2),m(T.luciferCynabal,3),m(T.luciferDramiel,2),m(T.luciferFury,1),m(T.luciferIxion,2),m(T.luciferSwordspine,1),
  ],"Exact live T6 composition observed in Abyssal.Space telemetry; not asserted as the family maximum."),
];

export const ABYSS_DATASET_PROVENANCE = {
  roomSource: "EVE University room table (2026-01-16 revision) plus exact live T6 compositions observed in Abyssal.Space telemetry",
  staticStats: "CCP EVE static data (local SDE)",
  telemetryCrossCheck: "Abyssal.Space recent run telemetry",
  calculationMode: "documented-threat-envelope-plus-observed-compositions",
  limitation: "T6 remains non-exhaustive: Sage includes the two public documented rows plus distinct exact live telemetry observations. Observed compositions are not merged into guessed family-wide min/max ranges, and unreported linked spawns are not invented.",
};

export function validAbyssPenalties(tier: AbyssTier): AbyssPenalty[] {
  return tier <= 3 ? [0.3, 0.5] : [0.5, 0.7];
}

export function normalizeAbyssPenalty(tier: AbyssTier, value?: number): AbyssPenalty {
  const valid = validAbyssPenalties(tier);
  if (valid.includes(value as AbyssPenalty)) return value as AbyssPenalty;
  return valid[valid.length - 1];
}

export function abyssResistanceChannel(weather: AbyssWeather): 0 | 1 | 2 | 3 | undefined {
  if (weather === "electrical") return 0;
  if (weather === "firestorm") return 1;
  if (weather === "exotic") return 2;
  if (weather === "gamma") return 3;
  return undefined;
}

export function applyAbyssWeatherResists(resists: number[], weather: AbyssWeather, penalty: AbyssPenalty): [number, number, number, number] {
  const next = [resists[0] ?? 0, resists[1] ?? 0, resists[2] ?? 0, resists[3] ?? 0] as [number, number, number, number];
  const channel = abyssResistanceChannel(weather);
  if (channel != null) next[channel] = Math.max(0, 1 - (1 - next[channel]) * (1 + penalty));
  return next;
}

export function applyAbyssWeatherHp(hp: { shieldHp: number; armorHp: number; structureHp: number }, weather: AbyssWeather) {
  return {
    shieldHp: hp.shieldHp * (weather === "gamma" ? 1.5 : 1),
    armorHp: hp.armorHp * (weather === "firestorm" ? 1.5 : 1),
    structureHp: hp.structureHp,
  };
}

export function abyssEncountersForTier(tier: AbyssTier) {
  return ABYSS_ENCOUNTERS.filter((encounter) => encounter.tiers.includes(tier));
}
