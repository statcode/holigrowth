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
  const response = await fetch(OPENROUTER_URL, {
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
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${body}`);
  }
  if (!response.body) {
    throw new Error("OpenRouter returned no response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
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
  }
}
