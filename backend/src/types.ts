export interface EventEnvelope {
  sequence: number;
  workspace_id: string;
  event_type: string;
  object_id: string | null;
  object_version: number | null;
  created_at: string;
}

export interface SageEnv {
  DB: D1Database;
  WORKSPACE_HUB: DurableObjectNamespace;
  EVENT_QUEUE: Queue<EventEnvelope>;
  APP_VERSION: string;
  ESI_COMPATIBILITY_DATE: string;
  EVE_CLIENT_ID?: string;
  EVE_CLIENT_SECRET?: string;
  EVE_REDIRECT_URI?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_REDIRECT_URI?: string;
}

export interface Principal {
  accountId: string;
  sessionId: string;
}
