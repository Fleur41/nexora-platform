import { expect } from "@playwright/test";

/**
 * Reads emails the app sent, from Mailpit (docker compose up -d mailpit). Django must send
 * through it: EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend, EMAIL_PORT=1025.
 */
const MAILPIT = (process.env.MAILPIT_URL ?? "http://localhost:8025").replace(/\/$/, "");

interface MailpitSummary {
  ID: string;
  Subject: string;
}

/** Wait for the newest email to `to` and return the first link in it matching `pattern`. */
export async function linkFromEmail(to: string, pattern: RegExp, timeoutMs = 15_000): Promise<string> {
  let link = "";
  await expect
    .poll(
      async () => {
        let res: Response;
        try {
          res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`);
        } catch {
          throw new Error(`Mailpit isn't reachable at ${MAILPIT}. Start it with: docker compose up -d mailpit`);
        }
        const { messages } = (await res.json()) as { messages: MailpitSummary[] };
        if (!messages.length) return "";
        const message = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`)).json()) as { Text: string };
        link = message.Text.match(pattern)?.[0] ?? "";
        return link;
      },
      { message: `an email to ${to} containing ${pattern}`, timeout: timeoutMs },
    )
    .not.toBe("");
  return link;
}
