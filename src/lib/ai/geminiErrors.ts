export class GeminiRateLimitError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string) {
    super(userMessage);
    this.name = "GeminiRateLimitError";
    this.userMessage = userMessage;
  }
}

export const GEMINI_RATE_LIMIT_MESSAGE =
  "Wyczerpano chwilowy limit zapytań konta Google. Twój darmowy asystent musi odpocząć przez około 60 sekund. Poczekaj chwilę i spróbuj ponownie.";

export function mapGeminiInvokeError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("GEMINI_RATE_LIMIT:")) {
    const text = msg.split("GEMINI_RATE_LIMIT:")[1]?.trim();
    return new GeminiRateLimitError(text || GEMINI_RATE_LIMIT_MESSAGE);
  }
  return e instanceof Error ? e : new Error(msg);
}

export function isGeminiRateLimitError(e: unknown): e is GeminiRateLimitError {
  return e instanceof GeminiRateLimitError;
}
