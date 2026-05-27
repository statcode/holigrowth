/**
 * Minimal OpenRouter chat-completions client. Streams an OpenAI-compatible SSE
 * response and yields content chunks one at a time.
 *
 * OpenRouter's API surface is OpenAI-shaped, so the message structure mirrors
 * `openai.chat.completions.create` — but we use raw `fetch` to avoid pulling
 * in the OpenAI SDK just for one call site.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Hard timeout for the whole request — from fetch start to last byte.
   *  If exceeded, the underlying connection is aborted and the iterator
   *  rejects. Default 180s. */
  requestTimeoutMs?: number;
  /** Idle-stall timeout — if no chunk arrives within this window, the
   *  connection is aborted. Catches OpenRouter / upstream stream stalls
   *  where the TCP connection is open but no bytes are flowing. Default 45s. */
  idleTimeoutMs?: number;
  /** External AbortSignal — caller can cancel the request (e.g. when the
   *  customer closes the /preview tab). */
  signal?: AbortSignal;
}

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to .env — get a key at https://openrouter.ai/keys",
    );
  }
  return key;
}

/**
 * Stream a chat completion. Yields content deltas (strings) as they arrive.
 * Throws if the API responds with a non-2xx status or returns no body.
 */
export async function* streamChatCompletion(
  options: StreamChatOptions,
): AsyncGenerator<string, void, void> {
  const requestTimeoutMs = options.requestTimeoutMs ?? 180_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 45_000;

  // Compose a single AbortController that fires on:
  //   1. The caller's external signal (if provided)
  //   2. The hard request-timeout
  //   3. The idle-stall timer (reset on every chunk read)
  // OpenRouter sometimes opens an SSE connection and then stops emitting
  // bytes without closing the TCP socket — without idleTimeoutMs we'd hang
  // forever waiting for the next `read()` to resolve.
  const controller = new AbortController();
  const reasonRef: { reason: string | null } = { reason: null };
  const fail = (reason: string) => {
    if (controller.signal.aborted) return;
    reasonRef.reason = reason;
    controller.abort();
  };

  const hardTimer = setTimeout(() => fail(`request timeout after ${requestTimeoutMs}ms`), requestTimeoutMs);
  let idleTimer: ReturnType<typeof setTimeout> | null = setTimeout(
    () => fail(`idle stall after ${idleTimeoutMs}ms with no chunks from OpenRouter`),
    idleTimeoutMs,
  );
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => fail(`idle stall after ${idleTimeoutMs}ms with no chunks from OpenRouter`),
      idleTimeoutMs,
    );
  };

  // Wire the caller's external abort signal in as well.
  const externalAbort = () => fail("caller aborted");
  if (options.signal) {
    if (options.signal.aborted) externalAbort();
    else options.signal.addEventListener("abort", externalAbort, { once: true });
  }

  const cleanup = () => {
    clearTimeout(hardTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (options.signal) options.signal.removeEventListener("abort", externalAbort);
  };

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: true,
        ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    cleanup();
    if (controller.signal.aborted && reasonRef.reason) {
      throw new Error(`OpenRouter request aborted: ${reasonRef.reason}`);
    }
    throw err;
  }

  if (!response.ok) {
    cleanup();
    const body = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${body}`);
  }
  if (!response.body) {
    cleanup();
    throw new Error("OpenRouter returned no response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      let value: Uint8Array | undefined;
      let done: boolean;
      try {
        ({ value, done } = await reader.read());
        resetIdle();
      } catch (err) {
        if (controller.signal.aborted && reasonRef.reason) {
          throw new Error(`OpenRouter stream aborted: ${reasonRef.reason}`);
        }
        throw err;
      }
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Each SSE event is delimited by a blank line. Parse complete events
      // and leave any partial trailer in the buffer for the next read.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          let parsed: { choices?: { delta?: { content?: string } }[] };
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }

          const content = parsed.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content.length > 0) {
            yield content;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
    cleanup();
  }
}
