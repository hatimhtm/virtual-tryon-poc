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
      const bgKey = background || 'studio_white';

      // ─── STEP 1: describe the user's selfie via gemini-2.5-flash (vision text)
      // The image generation model (gemini-2.5-flash-image) is biased toward
      // single-image-edit and tends to return Image 2 unchanged when given
      // two images. Two-step pipeline collapses this to a single-image-edit
      // task by replacing Image 1 with a rich text description.
      const describe = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Décris cette personne pour qu'un autre modèle d'IA puisse la régénérer fidèlement dans un essayage virtuel de vêtements. Sois précis et factuel sur :
- Genre apparent
- Tranche d'âge (e.g. early 20s, mid 30s)
- Couleur de peau (description précise : "warm olive", "fair with pink undertones", "deep brown", etc.)
- Forme du visage, traits faciaux distinctifs (yeux, nez, bouche, pommettes)
- Couleur, longueur, et style de cheveux
- Pilosité faciale s'il y en a
- Accessoires visibles (lunettes, boucles d'oreilles, etc.)
- Morphologie/build apparente si visible (slim, athletic, curvy, etc. — si on ne voit qu'un visage, devine raisonnablement)

Réponds en anglais, en un seul paragraphe descriptif de 80-120 mots. Pas d'introduction, pas de "Here is the description", commence directement. Le but est qu'un modèle qui n'a jamais vu cette personne puisse la dessiner fidèlement à partir de ta description.`,
              },
              { inlineData: { data: user.base64Data, mimeType: user.mimeType } },
            ],
          },
        ],
      });

      const personDescription = describe.text?.trim() || 'a person';
      console.log('[generate-tryon] person description:', personDescription.slice(0, 200));

      // ─── STEP 2: image generation
      // Pass clothing FIRST then selfie LAST. gemini-2.5-flash-image is biased
      // toward editing the *last* image — when the selfie is last, the bias
      // works for us instead of against us (it edits the person to wear the
      // garment, rather than editing the garment to remove its model).
      //
      // The text description from Step 1 stays in the prompt as
      // identity reinforcement: belt + suspenders. The model now has both the
      // selfie pixels AND the text traits to lock the face onto.
      const bgDescription = BACKGROUND_PROMPTS[bgKey] || BACKGROUND_PROMPTS.studio_white;
      const editPrompt = `You are an expert lifestyle fashion photographer working on a virtual try-on.

INPUT IMAGES (in order):
  • Image 1 = the GARMENT (a catalogue/product photo showing the clothing to use)
  • Image 2 = the PERSON (the user — this is the person who must appear in the output)

TASK: Edit the PERSON (Image 2) so that they are now wearing the GARMENT (Image 1), in a new lifestyle setting. The output must be a brand new photograph of the same person from Image 2, with the same face, skin tone, hair, and features — just now wearing the garment from Image 1, in a flattering pose and background.

FACE & IDENTITY (the most important rule):
- The face, skin tone, hair, eyes, lips, and overall identity in the output MUST match the person in Image 2 (the selfie) — this is who the user wants to see in the try-on.
- Reference description of the person from Image 2 to help you lock identity: ${personDescription}
- Do not generate a generic face or invent new features. The output face must be recognisably the same person as Image 2.
- Preserve facial hair, hairstyle, hair colour, and any visible accessories (glasses, earrings) from Image 2.

GARMENT:
- Use the clothing/outfit from Image 1. Replace whatever the person in Image 2 was originally wearing.
- The garment must drape and fit the person's build naturally — adjust the size to their body.
- If Image 1 shows a full outfit, use the whole outfit.
- Do NOT keep the original catalogue model from Image 1. Image 1 is a clothing reference only.

FRAMING & POSE:
- Lifestyle shot — Instagram-style, waist-up or chest-up. Not a stiff studio full-body.
- Slight smile, relaxed candid pose, natural body angle. Happy and confident.
- Even if Image 2 is a tight selfie of the face, RECONSTRUCT the rest of the body and pose naturally — do NOT just keep the original framing.

BACKGROUND & LIGHTING:
- Place the person in: ${bgDescription}.
- Warm flattering natural light, soft shadows, beautifully blurred background (bokeh).
- This must look like a real lifestyle photograph, not a studio composite.

QUALITY:
- Photorealistic. No visible editing seams. Skin tones uniform across face, neck, and arms.
- The image must make someone want to buy the outfit immediately AND recognise themselves in it.

Output the image now.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [
          {
            role: 'user',
            parts: [
              { text: editPrompt },
              { text: '\n=== IMAGE 1 (the GARMENT — clothing reference; do NOT keep its original model): ===' },
              { inlineData: { data: clothe.base64Data, mimeType: clothe.mimeType } },
              { text: '\n=== IMAGE 2 (the PERSON — preserve THIS face, skin tone, hair, and identity in the output): ===' },
              { inlineData: { data: user.base64Data, mimeType: user.mimeType } },
              { text: '\nNow edit Image 2 to show this same person wearing the garment from Image 1, in the lifestyle setting described above.' },
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
