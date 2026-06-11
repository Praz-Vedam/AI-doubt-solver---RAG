import OpenAI from "openai";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// Diagram roles: "index" = knowledgebase indexing LLM (open-source/Ollama),
// "chat" = query-time LLM (cloud API, token-based usage). Each role can have
// its own provider/model via env; both default to the shared LLM_PROVIDER.
export type LlmRole = "chat" | "index";

export type LlmProvider = "ollama" | "openai" | "openrouter";

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function getOllamaBaseUrl(): string {
  const base = normalizeBaseUrl(
    process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  );
  return `${base}/v1`;
}

function getProvider(role: LlmRole, override?: LlmProvider): string {
  if (override) return override;
  const roleProvider =
    role === "index" ? process.env.LLM_INDEX_PROVIDER : process.env.LLM_CHAT_PROVIDER;
  return roleProvider ?? process.env.LLM_PROVIDER ?? "ollama";
}

function getModel(role: LlmRole, providerOverride?: LlmProvider): string {
  // A forced provider must not inherit a role model meant for another provider
  // (e.g. LLM_CHAT_MODEL=gpt-4o-mini when forcing Ollama).
  if (providerOverride === "ollama") {
    return process.env.LLM_MODEL ?? "qwen2.5:7b";
  }
  const roleModel =
    role === "index" ? process.env.LLM_INDEX_MODEL : process.env.LLM_CHAT_MODEL;
  return roleModel ?? process.env.LLM_MODEL ?? "qwen2.5:7b";
}

function getClient(role: LlmRole, providerOverride?: LlmProvider): OpenAI {
  const provider = getProvider(role, providerOverride);

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required when LLM provider is openai");
    }
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, ...getClientOptions() });
  }

  if (provider === "openrouter") {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is required when LLM provider is openrouter");
    }
    return new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Video Knowledge Chatbot",
      },
      ...getClientOptions(),
    });
  }

  if (provider === "ollama") {
    const headers: Record<string, string> = {};
    const baseURL = getOllamaBaseUrl();
    if (baseURL.includes("ngrok")) {
      headers["ngrok-skip-browser-warning"] = "true";
    }

    return new OpenAI({
      apiKey: process.env.OLLAMA_API_KEY ?? "ollama",
      baseURL,
      defaultHeaders: headers,
      ...getClientOptions(),
    });
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}

function getClientOptions(): ConstructorParameters<typeof OpenAI>[0] {
  return { timeout: 120_000, maxRetries: 1 };
}

function toTokenUsage(
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined,
): TokenUsage | null {
  if (!usage) return null;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}

export async function completeTextDetailed(options: {
  system: string;
  user: string;
  temperature?: number;
  role?: LlmRole;
  provider?: LlmProvider;
}): Promise<{ text: string; usage: TokenUsage | null }> {
  const role = options.role ?? "chat";
  const client = getClient(role, options.provider);
  const response = await client.chat.completions.create({
    model: getModel(role, options.provider),
    temperature: options.temperature ?? 0,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
  });

  return {
    text: response.choices[0]?.message?.content?.trim() ?? "",
    usage: toTokenUsage(response.usage),
  };
}

export async function completeText(options: {
  system: string;
  user: string;
  temperature?: number;
  role?: LlmRole;
  provider?: LlmProvider;
}): Promise<string> {
  const { text } = await completeTextDetailed(options);
  return text;
}

export async function completeJson<T>(options: {
  system: string;
  user: string;
  temperature?: number;
  role?: LlmRole;
  provider?: LlmProvider;
}): Promise<T> {
  const content = await completeText({
    ...options,
    system: `${options.system}\nRespond with valid JSON only.`,
  });

  const cleaned = content.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned) as T;
}

export async function streamText(options: {
  messages: ChatMessage[];
  temperature?: number;
  role?: LlmRole;
}): Promise<{ stream: ReadableStream<Uint8Array>; getUsage: () => TokenUsage | null }> {
  const role = options.role ?? "chat";
  const client = getClient(role);
  const stream = await client.chat.completions.create({
    model: getModel(role),
    temperature: options.temperature ?? 0,
    stream: true,
    stream_options: { include_usage: true },
    messages: options.messages,
  });

  const encoder = new TextEncoder();
  let usage: TokenUsage | null = null;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.usage) {
            usage = toTokenUsage(chunk.usage);
          }
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            controller.enqueue(encoder.encode(delta));
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return { stream: readable, getUsage: () => usage };
}
