import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { userImage, clotheImage } = await req.json();

    if (!userImage || !clotheImage) {
      return NextResponse.json({ error: 'Veuillez fournir la photo de l\'utilisateur et la photo du vêtement.' }, { status: 400 });
    }

    const getBase64AndMime = (dataUrl: string) => {
      const base64Data = dataUrl.split(',')[1];
      const mimeType = dataUrl.split(',')[0].split(':')[1].split(';')[0] || 'image/jpeg';
      return { base64Data, mimeType };
    };

    const user = getBase64AndMime(userImage);
    const clothe = getBase64AndMime(clotheImage);

    // Début du traitement
    try {
      // Tentative d'appel au modèle Nano Banana 2 (Gemini 3.1 Flash Image)
      const prompt = `Virtually try on the clothing from Image 2 onto the person in Image 1. Keep the person's face completely unchanged. Make it photorealistic.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash',
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

      // On cherche l'image générée dans les "parts" de la réponse de Nano Banana
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
          message: "Essayage virtuel généré avec succès avec Nano Banana 2."
        });
      } else {
        // L'API n'a pas renvoyé d'image
        // On vérifie le texte retourné pour comprendre ce qui se passe
        const textResponse = response.text || "Pas de texte et pas d'image trouvée.";
        console.warn("Nano Banana Response:", textResponse);
        throw new Error("L'API n'a pas retourné d'image valide. Message IA : " + textResponse.substring(0, 100));
      }
      
    } catch (apiError: any) {
      console.error("L'API a échoué : ", apiError);
      return NextResponse.json(
        { error: "Échec de l'IA (Nano Banana) : " + apiError.message },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('Generation Error:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la génération de l\'essayage', details: error.message },
      { status: 500 }
    );
  }
}
