import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { rateLimit, clientKey, rateLimitHeaders } from '@/lib/rate-limit';

export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });

// 5 generations per IP per hour — Gemini image generation is the expensive
// call, so this is the harder cap.
const RATE = { windowMs: 60 * 60 * 1000, max: 5 };

const BACKGROUND_PROMPTS: Record<string, string> = {
  studio_white: "a clean white professional photography studio with soft, even lighting and no shadows on the background",
  studio_gray: "a neutral medium-gray photography studio backdrop with soft professional lighting",
  urban: "a blurred modern urban street with warm natural daylight, shot with shallow depth of field",
  minimal_beige: "a warm minimalist beige interior with soft natural window light",
  outdoor_nature: "a softly blurred green park or garden setting with natural sunlight filtering through trees",
};

function buildPrompt(backgroundKey: string): string {
  const bgDescription = BACKGROUND_PROMPTS[backgroundKey] || BACKGROUND_PROMPTS.studio_white;

  return `You are an expert fashion photography retoucher and virtual try-on specialist.

TASK: Generate a single photorealistic image of the PERSON from Image 1 wearing the CLOTHING from Image 2.

CRITICAL RULES — follow every single one:

1. BODY PRESERVATION:
   - The generated person must have the EXACT same body type, build, proportions, height, and weight as the person in Image 1.
   - Preserve their skin tone and complexion EVERYWHERE — face, neck, hands, arms, wrists, all visible skin. The skin color must be uniform and match Image 1 precisely.
   - Preserve their face exactly: same facial features, expression, facial hair, hairstyle, hair color.
   - Preserve any visible accessories (watch, bracelet, earrings, rings) from Image 1.

2. CLOTHING APPLICATION:
   - Take ONLY the clothing/garment from Image 2 and dress the person from Image 1 in it.
   - The clothing must fit naturally on THEIR body — drape, fold, and wrinkle realistically based on their actual body shape and pose.
   - If Image 2 shows a full outfit (e.g. a 3-piece suit), apply the entire outfit.
   - Adjust the garment size to match the person's body — do NOT keep the fit from the original model in Image 2.

3. POSE & COMPOSITION:
   - Use a natural, confident standing pose similar to Image 1.
   - Frame the shot as a professional fashion photograph: roughly 3/4 body or full body.

4. BACKGROUND & LIGHTING:
   - Place the person in: ${bgDescription}.
   - The lighting on the person must match the background environment — consistent shadows, highlights, color temperature.
   - This must look like a real photograph taken in that setting, not a composite or cutout.

5. PHOTOREALISM:
   - The final image must be indistinguishable from a real high-end fashion photograph.
   - No artifacts, no visible editing seams, no mismatched skin tones between body parts.
   - Smooth, natural transitions between skin and clothing edges.

Generate the image now.`;
}

export async function POST(req: Request) {
  try {
    const rl = rateLimit(clientKey(req), RATE);
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: `Quota atteint — ${RATE.max} essais par heure. Réessayez dans ${Math.ceil(rl.resetIn / 60)} min.`,
        },
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

    const getBase64AndMime = (dataUrl: string) => {
      const base64Data = dataUrl.split(',')[1];
      const mimeType = dataUrl.split(',')[0].split(':')[1].split(';')[0] || 'image/jpeg';
      return { base64Data, mimeType };
    };

    const user = getBase64AndMime(userImage);
    const clothe = getBase64AndMime(clotheImage);

    try {
      const prompt = buildPrompt(background || 'studio_white');

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { data: user.base64Data, mimeType: user.mimeType } },
              { inlineData: { data: clothe.base64Data, mimeType: clothe.mimeType } }
            ]
          }
        ]
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
