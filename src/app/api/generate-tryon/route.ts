import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { rateLimit, clientKey, rateLimitHeaders } from '@/lib/rate-limit';

export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });

// 5 generations per IP per hour — Gemini image generation is the expensive
// call, so this is the harder cap.
const RATE = { windowMs: 60 * 60 * 1000, max: 5 };

// Rich lifestyle background descriptions — keyed to the 5 UI presets.
// Lifted from the iOS app's curated pool and adapted into a presetable shape.
const BACKGROUND_PROMPTS: Record<string, string> = {
  studio_white: "a clean editorial white studio with soft, diffused natural-feeling lighting, subtle floor shadow, magazine-shoot quality",
  studio_gray: "a neutral medium-gray editorial studio backdrop with soft, flattering directional lighting and a subtle gradient",
  urban: "a chic European city sidewalk in warm afternoon golden hour — blurred boutique storefronts and pedestrians in the background, shot with shallow depth of field for that Instagram lifestyle feel",
  minimal_beige: "a warm minimalist beige interior with soft natural window light, blurred wooden furniture and a single plant in the background, lifestyle-blog mood",
  outdoor_nature: "a beautifully blurred green park at golden hour, dappled natural sunlight filtering through trees, soft bokeh in the background, candid lifestyle feel",
};

function buildPrompt(backgroundKey: string): string {
  const bgDescription = BACKGROUND_PROMPTS[backgroundKey] || BACKGROUND_PROMPTS.studio_white;

  return `You are an expert lifestyle fashion photographer and virtual try-on specialist.

TASK: Generate a single photorealistic LIFESTYLE image of the PERSON from Image 1 wearing the CLOTHING from Image 2.

CRITICAL RULES — follow every single one:

1. PERSON PRESERVATION:
   - The generated person must have the EXACT same body type, build, proportions, skin tone, and complexion as the person in Image 1.
   - Preserve their face exactly: same facial features, facial hair, hairstyle, hair color.
   - Preserve any visible accessories (watch, bracelet, earrings, rings) from Image 1.
   - Skin color must be uniform and match Image 1 precisely on ALL visible skin (face, neck, hands, arms).
   - EVEN IF IMAGE 1 IS A SELFIE OR A CLOSE-UP OF THE FACE, you MUST reconstruct the full person faithfully based on the visible features (face, skin tone, hair, apparent age). Do not refuse, do not return the clothing photo unchanged — generate a complete, full-body person wearing the garment.

2. CLOTHING APPLICATION:
   - Take ONLY the clothing/garment from Image 2 and dress the person from Image 1 in it.
   - The clothing must fit naturally on THEIR body — drape, fold, and wrinkle realistically based on their actual body shape.
   - If Image 2 shows a full outfit (e.g. a dress, a suit), apply the entire outfit.
   - Adjust the garment size to match the person's body — do NOT keep the fit from the original model in Image 2.

3. POSE & FRAMING — THIS IS CRITICAL:
   - LIFESTYLE SHOT: the person should look like they are living their life — walking, leaning on a wall, smiling naturally, holding a coffee, adjusting their hair, or posing casually for a friend's photo.
   - CLOSE TO MEDIUM FRAMING: frame the shot from the waist up or chest up. NOT a distant full-body studio shot. Think Instagram-style lifestyle photo or casual shot taken by a friend.
   - The person should look HAPPY, CONFIDENT, and NATURAL — slight smile, relaxed posture, eyes engaging with the camera or looking slightly off-camera.
   - Slight head tilt or body angle for a dynamic, candid feel. NOT stiff or mannequin-like.

4. BACKGROUND & LIGHTING:
   - Place the person in: ${bgDescription}.
   - Use warm, flattering natural light — golden hour feel where appropriate, soft shadows.
   - The background should be beautifully BLURRED (bokeh effect) to keep focus on the person and the outfit.
   - This must look like a real lifestyle photograph, not a studio composite or cutout.

5. PHOTOREALISM & QUALITY:
   - The final image must look like a high-quality Instagram or fashion-blog photo.
   - No artifacts, no visible editing seams, no mismatched skin tones between body parts.
   - Smooth, natural transitions between skin and clothing edges.
   - The image should make someone want to buy the outfit immediately.

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
        model: 'gemini-2.5-flash-image',
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
