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
            text: `You are a professional interior design renderer. Place this furniture piece as the clear focal point in a beautifully staged, modern living room.

Rules you must follow:
- The furniture must face the camera directly — never face away from the viewer
- The furniture is the hero of the image — centred, well-lit, and dominant in the frame
- The living room is staged around the furniture: a rug beneath it, soft ambient lighting from above and the sides, a tasteful background with walls, artwork, and plants
- NO television, screens, or media units in the scene — this is a showroom-style render
- The camera angle is a slight 3/4 front view at eye level, as if a customer is viewing it in a showroom
- Preserve the furniture's exact fabric texture, colour, pattern, and material from the input image — do not change or improve it
- Photorealistic, 8K quality, soft natural lighting`,
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
