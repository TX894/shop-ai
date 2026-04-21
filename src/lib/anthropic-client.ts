import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;
let _lastKey: string | null = null;

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_KEY ?? "";
  if (!key) {
    throw new Error("ANTHROPIC_KEY is not set. Add it in Vercel env vars or .env.local.");
  }
  if (!_client || key !== _lastKey) {
    _client = new Anthropic({ apiKey: key });
    _lastKey = key;
  }
  return _client;
}

export async function complete(
  system: string,
  userMessage: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const client = getClient();
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: options?.maxTokens ?? 1024,
    temperature: options?.temperature ?? 0.3,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  return block.text;
}
