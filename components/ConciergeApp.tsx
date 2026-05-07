"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ChatMessage, ChatStreamEvent, ConversationState, TraceEvent } from "@/lib/agent/types";

function createInitialState(): ConversationState {
  return {
    conversationId: `client_${Date.now().toString(36)}`,
    messages: [
      {
        id: "welcome",
        role: "assistant",
        content: "Hi, I am Bookly Order Concierge. What can I help with today?",
        createdAt: new Date().toISOString()
      }
    ],
    workflowState: {},
    traceEvents: []
  };
}

function renderMessageContent(content: string) {
  const parts = content.split(/(\/api\/labels\/RL-\d+)/g);
  return parts.map((part) =>
    part.match(/^\/api\/labels\/RL-\d+$/) ? (
      <a href={part} target="_blank" rel="noreferrer" key={part}>
        {part}
      </a>
    ) : (
      part
    )
  );
}

function scrollToBottom(element: HTMLElement | null) {
  if (!element) {
    return;
  }

  requestAnimationFrame(() => {
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  });
}

function createOptimisticUserMessage(content: string): ChatMessage {
  return {
    id: `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
    role: "user",
    content,
    createdAt: new Date().toISOString()
  };
}

async function readChatStream(response: Response, onEvent: (event: ChatStreamEvent) => void) {
  if (!response.body) {
    throw new Error("Chat response did not include a stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        onEvent(JSON.parse(line) as ChatStreamEvent);
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as ChatStreamEvent);
  }
}

function appendTraceEvent(state: ConversationState, event: TraceEvent): ConversationState {
  if (state.traceEvents.some((existingEvent) => existingEvent.id === event.id)) {
    return state;
  }

  return {
    ...state,
    traceEvents: [...state.traceEvents, event]
  };
}

function progressText(message: string | null) {
  return (message ?? "Working").replace(/\.+$/, "");
}

export function ConciergeApp({ initialMode = "demo" }: { initialMode?: "demo" | "live" }) {
  const [state, setState] = useState<ConversationState>(() => createInitialState());
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"demo" | "live">(initialMode);
  const [isSending, setIsSending] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  const hasDraft = draft.trim().length > 0;
  const canSend = hasDraft && !isSending;

  useEffect(() => {
    scrollToBottom(messageListRef.current);
  }, [state.messages.length, isSending, progressMessage]);

  useEffect(() => {
    if (!isSending) {
      inputRef.current?.focus();
    }
  }, [isSending]);

  async function sendMessage(message: string) {
    const requestState = state;
    const optimisticMessage = createOptimisticUserMessage(message);

    setIsSending(true);
    setProgressMessage("Starting...");
    setError(null);
    setState((currentState) => ({
      ...currentState,
      messages: [...currentState.messages, optimisticMessage]
    }));

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, state: requestState })
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Chat request failed");
      }

      let receivedFinalState = false;
      await readChatStream(response, (event) => {
        if (event.type === "mode") {
          setMode(event.mode);
          return;
        }

        if (event.type === "progress") {
          setProgressMessage(event.message);
          return;
        }

        if (event.type === "trace_event") {
          setState((currentState) => appendTraceEvent(currentState, event.event));
          return;
        }

        if (event.type === "final") {
          receivedFinalState = true;
          setMode(event.mode);
          setState(event.state);
          return;
        }

        if (event.type === "error") {
          throw new Error(event.error);
        }
      });

      if (!receivedFinalState) {
        throw new Error("Chat stream ended before the agent returned a final response.");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Something went wrong.");
      setDraft((currentDraft) => currentDraft || message);
    } finally {
      setIsSending(false);
      setProgressMessage(null);
      inputRef.current?.focus();
    }
  }

  async function sendCurrentDraft() {
    if (!canSend) {
      return;
    }

    const message = draft.trim();
    setDraft("");
    await sendMessage(message);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    void sendCurrentDraft();
  }

  function resetConversation() {
    setState(createInitialState());
    setDraft("");
    setError(null);
    inputRef.current?.focus();
  }

  return (
    <main className="app-shell">
      <section className="chat-panel" aria-label="Chat">
        <header className="topbar">
          <div>
            <p className="eyebrow">Bookly</p>
            <h1>Order Concierge</h1>
          </div>
          <button className="secondary-button" type="button" onClick={resetConversation}>
            New Conversation
          </button>
        </header>

        <div className="message-list" ref={messageListRef}>
          {state.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {isSending ? (
            <div className="typing-indicator">
              {progressText(progressMessage)}
              <span className="typing-ellipsis" aria-hidden="true" />
            </div>
          ) : null}
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="composer" role="group" aria-label="Message composer">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder="Type a message"
          />
          <button type="button" disabled={!canSend} onClick={() => void sendCurrentDraft()}>
            Send
          </button>
        </div>
      </section>

      <TracePanel mode={mode} state={state} />
    </main>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <article className={`message message-${message.role}`}>
      <div className="message-role">{message.role === "assistant" ? "Bookly" : "Customer"}</div>
      <div className="message-content">{renderMessageContent(message.content)}</div>
    </article>
  );
}

function TracePanel({ mode, state }: { mode: "demo" | "live"; state: ConversationState }) {
  const traceFeedRef = useRef<HTMLDivElement>(null);
  const workflowState = state.workflowState;
  const currentIntent = typeof workflowState.intent === "string" ? workflowState.intent : "not set";
  const pendingAction = state.pendingAction?.description ?? "none";
  const signalCount =
    typeof workflowState.escalationSignalCount === "number" ? String(workflowState.escalationSignalCount) : "0";
  const signalSummary = workflowState.humanHelpRequested === true ? `human help; fuzzy ${signalCount}` : signalCount;
  const missing = useMemo(() => {
    const latestEvent = state.traceEvents[state.traceEvents.length - 1];
    return latestEvent?.eventType === "clarifying_question"
      ? latestEvent.resultSummary?.replace("Missing: ", "") ?? "none"
      : "none";
  }, [state.traceEvents]);

  useEffect(() => {
    scrollToBottom(traceFeedRef.current);
  }, [state.traceEvents.length]);

  return (
    <aside className="trace-panel" aria-label="Agent trace">
      <div className="trace-header">
        <div>
          <p className="eyebrow">Agent Trace</p>
          <h2>Runtime State</h2>
        </div>
        <span className={`mode-badge mode-${mode}`}>{mode === "live" ? "Live LLM" : "Demo Model"}</span>
      </div>

      <div className="trace-summary">
        <TraceStat label="Intent" value={currentIntent} />
        <TraceStat label="Missing" value={missing} />
        <TraceStat label="Signals" value={signalSummary} />
        <TraceStat label="Pending" value={pendingAction} />
      </div>

      <div className="trace-feed" ref={traceFeedRef}>
        {state.traceEvents.length === 0 ? (
          <div className="empty-trace">Trace events will appear as the agent works.</div>
        ) : (
          state.traceEvents.map((event) => <TraceEventCard key={event.id} event={event} />)
        )}
      </div>
    </aside>
  );
}

function TraceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="trace-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TraceEventCard({ event }: { event: TraceEvent }) {
  return (
    <article className={`trace-event trace-${event.eventType}`}>
      <div className="trace-event-topline">
        <span>{event.eventType.replaceAll("_", " ")}</span>
        {event.toolName ? <code>{event.toolName}</code> : null}
      </div>
      <h3>{event.title}</h3>
      {event.inputSummary ? <p>{event.inputSummary}</p> : null}
      {event.resultSummary ? <p>{event.resultSummary}</p> : null}
      {event.policySource ? <small>{event.policySource}</small> : null}
    </article>
  );
}
