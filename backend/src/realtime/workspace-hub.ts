import { DurableObject } from "cloudflare:workers";
import type { EventEnvelope, SageEnv } from "../types";

interface SocketAttachment {
  workspaceId: string;
  accountId: string;
}

export class WorkspaceHub extends DurableObject<SageEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = await request.json<EventEnvelope>();
      const body = JSON.stringify(event);
      let delivered = 0;
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(body);
          delivered += 1;
        } catch {
          // A dead socket is cleaned up by the runtime close/error lifecycle.
        }
      }
      return Response.json({ delivered });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const workspaceId = request.headers.get("X-Sage-Workspace-ID");
    const accountId = request.headers.get("X-Sage-Account-ID");
    if (!workspaceId || !accountId) {
      return new Response("Missing workspace context", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["sage-workspace"]);
    server.serializeAttachment({ workspaceId, accountId } satisfies SocketAttachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message === "string" && message === "ping") {
      socket.send("pong");
      return;
    }
    socket.send(JSON.stringify({ type: "sage.realtime.read_only" }));
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }
}
