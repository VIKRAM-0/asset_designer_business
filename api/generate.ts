import { GoogleGenAI } from '@google/genai';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageData } = req.body || {};
  if (!imageData) {
    return res.status(400).json({ error: 'Missing imageData' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY environment variable' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: imageData,
              mimeType: 'image/png',
            },
          },
          {
            text: 'Place this object in a modern, well-lit living room. Maintain the object\'s exact appearance and perspective. High quality, photorealistic, 4k.',
          },
        ],
      },
    });

    let generatedImageUrl: string | null = null;
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        generatedImageUrl = `data:image/png;base64,${part.inlineData.data}`;
        break;
      }
    }

    if (!generatedImageUrl) {
      return res.status(500).json({ error: 'No generated image returned' });
    }

    return res.status(200).json({ imageUrl: generatedImageUrl });
  } catch (error) {
    console.error('generate API error:', error);
    return res.status(500).json({ error: 'Failed to generate image' });
  }
}
