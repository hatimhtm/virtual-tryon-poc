import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { rateLimit, clientKey, rateLimitHeaders } from '@/lib/rate-limit';

export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });

const RATE = { windowMs: 60 * 60 * 1000, max: 5 };

const BACKGROUND_PROMPTS: Record<string, string> = {
  studio_white: "a clean editorial white studio with soft diffused lighting and a subtle floor shadow",
  studio_gray: "a neutral medium-gray editorial studio backdrop with soft directional lighting",
  urban: "a chic European city sidewalk at warm golden hour, blurred storefronts behind, shallow depth of field, lifestyle Instagram feel",
  minimal_beige: "a warm minimalist beige interior with soft window light and blurred wooden furniture in the background",
  outdoor_nature: "a beautifully blurred green park at golden hour with dappled sunlight and soft bokeh",
};

export async function POST(req: Request) {
  try {
    const rl = rateLimit(clientKey(req), RATE);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Quota atteint — ${RATE.max} essais par heure. Réessayez dans ${Math.ceil(rl.resetIn / 60)} min.` },
        { status: 429, headers: rateLimitHeaders(rl) },
      );
    }

    const { userImage, clotheImage, background } = await req.json();

    if (!userImage || !clotheImage) {
      return NextResponse.json(
        { error: "Veuillez fournir la photo de l'utilisateur et la photo du vêtement." },
        { status: 400, headers: rateLimitHeaders(rl) },
      );
    }

    const parseDataUrl = (dataUrl: string) => {
      const base64Data = dataUrl.split(',')[1];
      const mimeType = dataUrl.split(',')[0].split(':')[1].split(';')[0] || 'image/jpeg';
      return { base64Data, mimeType };
    };

    const user = parseDataUrl(userImage);
    const clothe = parseDataUrl(clotheImage);
    const bgKey = background || 'studio_white';
    const bgDescription = BACKGROUND_PROMPTS[bgKey] || BACKGROUND_PROMPTS.studio_white;

    // Single-step prompt. The image-gen model gets confused by long elaborate
    // multi-section prompts ("ABSOLUTE PROHIBITIONS", two-step descriptions,
    // etc.) — they dilute the task and produce worse output. Keep it short,
    // concrete, and label the two images explicitly. Pass the GARMENT first
    // and the SELFIE last — the model is biased toward editing the last
    // image, which is what we want (edit the person to wear the garment).
    const prompt = `You are doing a virtual try-on. Take the person in IMAGE 2 (the selfie) and dress them in the clothing shown in IMAGE 1.

Output a brand new photograph of the same person from Image 2 — keep their exact face, skin tone, hair, eyes, and identifying features identical — now wearing the garment from Image 1.

Framing: chest-up or waist-up lifestyle shot, relaxed natural pose, slight smile.
Background: ${bgDescription}.

Do NOT keep the catalogue model from Image 1; Image 1 is a clothing reference only. The output face must clearly match the person from Image 2.

Output the image.`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { text: '\n=== IMAGE 1 (the GARMENT — clothing reference only): ===' },
              { inlineData: { data: clothe.base64Data, mimeType: clothe.mimeType } },
              { text: '\n=== IMAGE 2 (the PERSON — preserve THIS face): ===' },
              { inlineData: { data: user.base64Data, mimeType: user.mimeType } },
            ],
          },
        ],
        config: { responseModalities: ['IMAGE'] },
      });

      let generatedImage = null;
      const parts = response.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('image/')) {
            generatedImage = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            break;
          }
        }
      }

      if (generatedImage) {
        return NextResponse.json({
          success: true,
          resultImage: generatedImage,
          message: "Essayage virtuel généré avec succès.",
        }, { headers: rateLimitHeaders(rl) });
      } else {
        const textResponse = response.text || "Pas de texte et pas d'image trouvée.";
        console.warn("Gemini Response:", textResponse);
        throw new Error("L'API n'a pas retourné d'image valide. Message IA : " + textResponse.substring(0, 100));
      }

    } catch (apiError: unknown) {
      console.error("L'API a échoué : ", apiError);
      const message = apiError instanceof Error ? apiError.message : String(apiError);
      return NextResponse.json(
        { error: "Échec de la génération : " + message },
        { status: 500 }
      );
    }

  } catch (error: unknown) {
    console.error('Generation Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Erreur lors de la génération de l\'essayage', details: message },
      { status: 500 }
    );
  }
}
