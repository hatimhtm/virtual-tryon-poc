import { NextResponse } from 'next/server';

/**
 * Minimal liveness probe. Returns 200 if the function can boot and the
 * Gemini API key is wired up. We don't actually call Gemini here —
 * that costs money on every uptime ping.
 */
export const runtime = 'nodejs';

export async function GET() {
    const hasKey = Boolean(process.env.GOOGLE_GENAI_API_KEY);
    return NextResponse.json(
        {
            ok: hasKey,
            status: hasKey ? 'ready' : 'misconfigured',
            now: new Date().toISOString(),
            gemini_key_present: hasKey,
        },
        { status: hasKey ? 200 : 500 },
    );
}
