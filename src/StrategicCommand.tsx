import { FormEvent, useEffect, useRef, useState } from "react";
import "./strategic-command.css";

type StrategicStatus = {
  configured: boolean;
  model: string;
  mcpReady: boolean;
  mcpError: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const STARTERS = [
  ["Fit & combat", "Skills, fittings, tank, DPS and tackle", "Build the best combat fit for one of my characters and validate it against their skills."],
  ["Corporation", "Operations, buyback, industry and logistics", "Give me a strategic overview of my corporation and tell me what needs attention."],
  ["Industry", "Blueprints, materials, reactions and markets", "Look across Sage and tell me the best industrial project we should work on next."],
  ["Market & ISK", "Markets, contracts, assets and opportunities", "Find the strongest money-making opportunities Sage can see right now."],
  ["Navigation", "Routes, systems, hazards and logistics", "Help me plan a route and tell me what risks I should account for."],
  ["Ask anything", "Use the whole Sage intelligence layer", "What can you help me with using everything Sage knows about my EVE setup?"],
] as const;

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function renderMessageContent(content: string) {
  return content.split(/\r?\n/).map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={index} className="sc-md-gap" />;
    if (/^---+$/.test(trimmed)) return <hr key={index} className="sc-md-rule" />;

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const className = `sc-md-heading sc-md-h${level}`;
      return <div key={index} className={className}>{renderInlineMarkdown(heading[2])}</div>;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      return <div key={index} className="sc-md-list-item"><span className="sc-md-bullet">&bull;</span><span>{renderInlineMarkdown(bullet[1])}</span></div>;
    }

    return <div key={index} className="sc-md-line">{renderInlineMarkdown(line)}</div>;
  });
}

export function StrategicCommand() {
  const sage = window.sage as any;
  const [status, setStatus] = useState<StrategicStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);

  async function refreshStatus() {
    setStatusLoading(true);
    try {
      const next = await sage.getStrategicCommandStatus() as StrategicStatus;
      setStatus(next);
      return next;
    } catch {
      setStatus(null);
      return null;
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => { void refreshStatus(); }, []);
  useEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;

    const resolvedStatus = status ?? await refreshStatus();
    if (!resolvedStatus?.configured) {
      setMessages((current) => [...current, {
        role: "assistant",
        content: "Sage AI is unavailable until your Sage account is connected.",
      }]);
      return;
    }

    setQuestion("");
    setBusy(true);
    const prior = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: text }]);

    try {
      const result = await sage.askStrategicCommand({ message: text, history: prior }) as { answer: string };
      setMessages((current) => [...current, { role: "assistant", content: result.answer }]);
    } catch (error) {
      setMessages((current) => [...current, {
        role: "assistant",
        content: error instanceof Error ? error.message : "Sage AI could not complete that request.",
      }]);
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  }

  const connected = Boolean(status?.configured && status?.mcpReady);
  const statusClass = statusLoading && !status ? "checking" : connected ? "online" : "offline";
  const statusLabel = statusLoading && !status
    ? "Checking Sage AI…"
    : connected
      ? "Sage AI ready"
      : status?.configured
        ? "Sage AI connection issue"
        : "Sage AI unavailable";

  return (
    <section className="sc-shell">
      <div className="sc-toolbar">
        <div className="sc-brand">
          <span className="sc-brand-mark">S</span>
          <div>
            <small>SAGE AI</small>
            <strong>Strategic Command</strong>
          </div>
        </div>

        <div className="sc-toolbar-actions">
          <div className={`sc-status ${statusClass}`}>
            <span className="sc-dot" />
            <span>{statusLabel}</span>
          </div>
          {messages.length > 0 && (
            <button type="button" onClick={() => setMessages([])} disabled={busy}>New conversation</button>
          )}
        </div>
      </div>

      <div className="sc-body">
        <div className="sc-thread" ref={conversationRef}>
          {!messages.length ? (
            <div className="sc-empty">
              <div className="sc-empty-inner">
                <div className="sc-orb">S</div>
                <h3>What do you want to do?</h3>
                <p>Ask naturally. Sage AI will use the right parts of Sage automatically and work from your live EVE data where available.</p>

                <div className="sc-starters">
                  {STARTERS.map(([title, detail, prompt]) => (
                    <button key={title} type="button" onClick={() => setQuestion(prompt)}>
                      <strong>{title}</strong>
                      <span>{detail}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {messages.map((message, index) => (
                <article key={index} className={`sc-message ${message.role}`}>
                  <div className="sc-avatar">{message.role === "user" ? "Y" : "S"}</div>
                  <div className="sc-message-content">
                    <div className="sc-message-label">{message.role === "user" ? "You" : "Sage AI"}</div>
                    <div className="sc-message-bubble">{renderMessageContent(message.content)}</div>
                  </div>
                </article>
              ))}
              {busy && (
                <article className="sc-message assistant">
                  <div className="sc-avatar">S</div>
                  <div className="sc-message-content">
                    <div className="sc-message-label">Sage AI</div>
                    <div className="sc-thinking"><span /><span /><span /> Working through Sage…</div>
                  </div>
                </article>
              )}
            </>
          )}
        </div>

        <form className="sc-composer" onSubmit={send}>
          <div className="sc-input-shell">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask Sage AI anything about EVE…"
              aria-label="Ask Sage AI"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button type="submit" className="sc-send" disabled={busy || !question.trim()}>
              {busy ? "Working…" : "Send"}
            </button>
          </div>
          <div className="sc-composer-meta">
            <span>{statusLoading && !status ? "Checking Sage AI connection…" : connected ? "Sage AI can use your data and actions automatically." : status?.configured ? "Sage AI is reconnecting to its local tools." : "Connect your Sage account to use Sage AI."}</span>
            <span>Enter to send · Shift+Enter for a new line</span>
          </div>
        </form>
      </div>
    </section>
  );
}
