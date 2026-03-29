import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Initialize the API using the key from .env.local
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { image } = await req.json();

    if (!image) {
      return NextResponse.json({ error: 'Aucune image fournie' }, { status: 400 });
    }

    // `image` should be a base64 string starting with "data:image/jpeg;base64,..."
    const base64Data = image.split(',')[1];
    const mimeType = image.split(',')[0].split(':')[1].split(';')[0] || 'image/jpeg';

    const prompt = `Voici une photo téléchargée par un utilisateur pour un essayage virtuel de vêtements. 
Tu dois évaluer si la photo est utilisable.
Critères :
1. Une personne doit être clairement visible.
2. Le cadrage doit montrer au moins le haut du corps (torse/épaules) ou le corps entier.
3. La luminosité doit être suffisante pour voir les formes.

Réponds UNIQUEMENT avec un objet JSON strict de cette forme :
{
  "isValid": true/false,
  "reason": "Explication courte en français de pourquoi c'est refusé (laisse vide si valide)"
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
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
    } catch (e) {
      console.error("Failed to parse JSON", e);
      resultJson = { isValid: false, reason: "Impossible d'analyser la photo correctement." };
    }

    return NextResponse.json(resultJson);
  } catch (error: any) {
    console.error('Validation Error:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la validation', details: error.message },
      { status: 500 }
    );
  }
}
