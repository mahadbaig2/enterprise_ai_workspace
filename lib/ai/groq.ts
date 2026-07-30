import Groq from 'groq-sdk';

const apiKey = process.env.GROQ_API_KEY || '';

export const groq = new Groq({
  apiKey: apiKey || 'dummy_key_for_initialization',
});

export const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

export async function generateGroqCompletion(systemPrompt: string, userPrompt: string) {
  if (!apiKey || apiKey === 'gsk_your_groq_api_key_here') {
    console.warn('GROQ_API_KEY is not configured. Returning fallback structured response.');
    return null;
  }

  try {
    const response = await groq.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_completion_tokens: 1024,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('Groq API Error:', error);
    return null;
  }
}
