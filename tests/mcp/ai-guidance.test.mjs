import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SAGE_MCP_AI_INSTRUCTIONS,
  SAGE_MCP_ROUTING_GUIDANCE,
  SAGE_CHARACTER_LIST_GUIDANCE,
  SAGE_CHARACTER_DATA_GUIDANCE,
  SAGE_SAVED_FITTINGS_GUIDANCE,
  SAGE_FIT_SKILL_GUIDANCE,
} from '../../electron/mcp-ai-policy.ts';

assert.match(SAGE_MCP_AI_INSTRUCTIONS, /source of truth/i);
assert.match(SAGE_MCP_AI_INSTRUCTIONS, /Do not guess/i);
assert.match(SAGE_MCP_AI_INSTRUCTIONS, /save tokens, latency, or compute/i);
assert.match(SAGE_MCP_AI_INSTRUCTIONS, /multiple synced characters.*ask the user which character/i);
assert.match(SAGE_MCP_AI_INSTRUCTIONS, /Fitting advice is skill-aware by default/i);
assert.match(SAGE_MCP_AI_INSTRUCTIONS, /get_character_data.*skills/i);
assert.match(SAGE_MCP_AI_INSTRUCTIONS, /generic, all-skills-V, or theorycraft/i);
assert.match(SAGE_MCP_AI_INSTRUCTIONS, /fallback only when Sage genuinely lacks/i);

assert.match(SAGE_MCP_ROUTING_GUIDANCE, /Semantic ownership beats keyword overlap/i);
assert.match(SAGE_MCP_ROUTING_GUIDANCE, /Corporation Command owns corporation workflows/i);
assert.match(SAGE_MCP_ROUTING_GUIDANCE, /90% buyback/i);
assert.match(SAGE_MCP_ROUTING_GUIDANCE, /MUST route to calculate_corp_ore_buyback/i);
assert.match(SAGE_MCP_ROUTING_GUIDANCE, /Do not answer those requests from search_market_orders/i);
assert.match(SAGE_MCP_ROUTING_GUIDANCE, /Market Command owns direct market research/i);
assert.match(SAGE_MCP_ROUTING_GUIDANCE, /Fitting owns fits/i);
assert.match(SAGE_MCP_ROUTING_GUIDANCE, /Navigation Command owns routes/i);
assert.match(SAGE_MCP_ROUTING_GUIDANCE, /Live Sage controls are a last-mile control surface/i);
assert.match(SAGE_MCP_AI_INSTRUCTIONS, /REQUEST ROUTING CONTRACT/i);

assert.match(SAGE_CHARACTER_LIST_GUIDANCE, /ask which character/i);
assert.match(SAGE_CHARACTER_DATA_GUIDANCE, /current skills/i);
assert.match(SAGE_CHARACTER_DATA_GUIDANCE, /do not infer or invent skill capability/i);
assert.match(SAGE_SAVED_FITTINGS_GUIDANCE, /not proof that every character can use it/i);
assert.match(SAGE_FIT_SKILL_GUIDANCE, /check that character's current skills/i);
assert.match(SAGE_FIT_SKILL_GUIDANCE, /usable substitutions/i);
assert.match(SAGE_FIT_SKILL_GUIDANCE, /training requirements/i);
assert.match(SAGE_FIT_SKILL_GUIDANCE, /not character-validated/i);

const serverSource = await readFile(new URL('../../electron/mcp-server.ts', import.meta.url), 'utf8');
assert.match(serverSource, /new McpServer\([^;]+instructions: SAGE_MCP_AI_INSTRUCTIONS/s);
assert.match(serverSource, /registerTool\("list_characters"[\s\S]+?description: SAGE_CHARACTER_LIST_GUIDANCE/);
assert.match(serverSource, /registerTool\("get_character_data"[\s\S]+?description: SAGE_CHARACTER_DATA_GUIDANCE/);
assert.match(serverSource, /registerTool\("get_saved_fittings"[\s\S]+?description: SAGE_SAVED_FITTINGS_GUIDANCE/);
assert.match(serverSource, /registerTool\("save_sage_fit"[\s\S]+?description: SAGE_FIT_SKILL_GUIDANCE/);
assert.match(serverSource, /registerTool\("push_eve_fitting"[\s\S]+?description: SAGE_FIT_SKILL_GUIDANCE/);
assert.match(serverSource, /registerTool\("calculate_corp_ore_buyback"[\s\S]+?title: "Calculate corp ore buyback"/);

console.log(JSON.stringify({
  sourceOfTruth: true,
  noGuessing: true,
  computeSavingOverride: true,
  ambiguousCharacterAsks: true,
  skillAwareFits: true,
  genericTheorycraftException: true,
  intentRoutingContract: true,
  corpBuybackRoutesToCorpCommand: true,
}, null, 2));
console.log('MCP AI GUIDANCE: PASS');
