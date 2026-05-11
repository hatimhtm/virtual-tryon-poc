import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { rateLimit, clientKey, rateLimitHeaders } from '@/lib/rate-limit';

export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });

// Validation is cheaper than generation, so allow more: 20 per IP per hour.
const RATE = { windowMs: 60 * 60 * 1000, max: 20 };

const VALIDATION_PROMPT = `Tu es un assistant expert en photographie pour une application d'essayage virtuel de vêtements.

Analyse cette photo envoyée par l'utilisateur et évalue si elle est utilisable pour générer un essayage virtuel réaliste.

CRITÈRES BLOQUANTS (si l'un échoue → isValid = false) :
1. UNE SEULE personne doit être visible sur la photo (pas de groupe, pas de foule).
2. La personne doit être clairement visible et reconnaissable (pas floue, pas cachée).
3. Le cadrage doit montrer AU MINIMUM le haut du corps (tête + torse + épaules). Un portrait en gros plan du visage uniquement ne suffit pas.
4. La luminosité doit être suffisante pour distinguer les formes du corps.
5. La personne doit être globalement face à la caméra (pas de dos, pas de profil complet).
6. La personne ne doit pas être un dessin, un avatar, ou une image générée par IA.

CRITÈRES DE QUALITÉ (n'empêchent pas la validation, mais génèrent des conseils) :
- Corps entier visible (pieds inclus) → meilleur résultat
- Pose debout et droite → meilleur résultat qu'assis ou penché
- Fond simple et uni → meilleur résultat qu'un fond chargé
- Bras visibles et non croisés → permet de mieux voir le vêtement
- Bonne résolution et netteté de l'image
- Vêtements actuels pas trop amples (pour mieux cerner la morphologie)

Réponds UNIQUEMENT avec un objet JSON strict :
{
  "isValid": boolean,
  "reason": "Si isValid=false : explication courte en français du problème principal.",
  "tips": ["Liste de 1 à 3 conseils concrets en français pour améliorer la photo, même si elle est valide. Chaque conseil doit être actionnable et court (max 15 mots). Ne donne des conseils que s'il y a vraiment quelque chose à améliorer. Si la photo est parfaite, tableau vide."]
}`;

export async function POST(req: Request) {
  try {
    const rl = rateLimit(clientKey(req), RATE);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Quota atteint — ${RATE.max} validations par heure. Réessayez plus tard.` },
        { status: 429, headers: rateLimitHeaders(rl) },
      );
    }

    const { image } = await req.json();

    if (!image) {
      return NextResponse.json(
        { error: 'Aucune image fournie' },
        { status: 400, headers: rateLimitHeaders(rl) },
      );
    }

    const base64Data = image.split(',')[1];
    const mimeType = image.split(',')[0].split(':')[1].split(';')[0] || 'image/jpeg';

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: VALIDATION_PROMPT },
            { inlineData: { data: base64Data, mimeType } }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
      }
    });

    const resultText = response.text || '{}';
    let resultJson;
    try {
      resultJson = JSON.parse(resultText);
      if (!Array.isArray(resultJson.tips)) {
        resultJson.tips = [];
      }
    } catch (e) {
      console.error("Failed to parse JSON", e);
      resultJson = { isValid: false, reason: "Impossible d'analyser la photo correctement.", tips: [] };
    }

    return NextResponse.json(resultJson, { headers: rateLimitHeaders(rl) });
  } catch (error: unknown) {
    console.error('Validation Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Erreur lors de la validation', details: message },
      { status: 500 }
    );
  }
}
