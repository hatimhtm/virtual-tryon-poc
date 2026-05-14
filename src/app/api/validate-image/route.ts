import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { rateLimit, clientKey, rateLimitHeaders } from '@/lib/rate-limit';

export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });

// Validation is cheaper than generation, so allow more: 20 per IP per hour.
const RATE = { windowMs: 60 * 60 * 1000, max: 20 };

const VALIDATION_PROMPT = `Tu es un assistant en photographie pour une application d'essayage virtuel de vêtements. Tu dois être TRÈS PERMISSIF — par défaut, accepte la photo. Ne rejette QUE si l'image est vraiment inutilisable.

PHILOSOPHIE : Le bénéfice du doute va TOUJOURS à l'utilisateur. Une photo "moyennement utilisable" doit être validée (avec des conseils si nécessaire), pas rejetée. Mieux vaut un essayage moins parfait qu'un blocage.

EXEMPLES de photos qui DOIVENT être acceptées (isValid = true) :
✓ Un selfie classique, même rapproché (visage + un peu d'épaules)
✓ Un portrait avec uniquement le visage visible (pas de corps)
✓ Une photo où le visage est légèrement coupé (front ou menton hors-cadre)
✓ Une photo prise en intérieur avec un éclairage modeste
✓ Une photo où la personne porte des lunettes, un chapeau, un foulard
✓ Une photo où la personne ne sourit pas, regarde ailleurs, ou fait un selfie miroir
✓ Une photo prise de 3/4 (légèrement de côté, pas pleinement face caméra)
✓ Une photo en pied, mi-corps, ou n'importe quel cadrage tant qu'une personne est identifiable

CRITÈRES BLOQUANTS (isValid = false UNIQUEMENT dans ces cas évidents) :
1. Il n'y a AUCUNE personne sur la photo (objet seul, paysage, animal, photo vide).
2. Il y a un GROUPE de personnes (plus d'une personne clairement visible). Si tu as un doute sur le nombre, accepte.
3. L'image est très clairement un dessin, une illustration cartoon, un avatar 3D, ou une image générée par IA évidente (style anime, Pixar, etc.).
4. La photo est si dégradée que tu ne peux PAS distinguer du tout les traits du visage (totalement noire, floue à 100%, ou très basse résolution illisible).

C'EST TOUT. Rien d'autre n'est bloquant. En cas de doute, valide (isValid = true) et ajoute un conseil dans tips.

CRITÈRES DE QUALITÉ (génèrent juste des conseils, ne bloquent JAMAIS) :
- Bonne résolution et netteté de l'image
- Fond pas trop chargé → meilleur résultat
- Éclairage naturel → meilleur résultat
- Visage de face plutôt que de profil → meilleur résultat
- Pas de chapeau / lunettes de soleil cachant les traits → meilleur résultat

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
