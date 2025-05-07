import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function getAIQuestion(): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a creative game host for 'What Would You Do?' game. Generate interesting, thought-provoking scenarios that players need to respond to. The scenarios should be fun, engaging, and appropriate for all ages."
        },
        {
          role: "user",
          content: "Generate a 'What Would You Do?' scenario. Make it creative and engaging."
        }
      ],
      temperature: 0.8,
      max_tokens: 100,
    });

    return completion.choices[0].message.content || "What would you do if you found a magic lamp?";
  } catch (error) {
    console.error('Error generating AI question:', error);
    return "What would you do if you found a magic lamp?";
  }
}

export async function getAIAnswer(question: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a creative player in the 'What Would You Do?' game. Generate interesting, unique, and sometimes humorous responses to scenarios. Keep responses concise (1-2 sentences) and engaging."
        },
        {
          role: "user",
          content: `Respond to this scenario: ${question}`
        }
      ],
      temperature: 0.9,
      max_tokens: 50,
    });

    return completion.choices[0].message.content || "I would probably just stand there and stare.";
  } catch (error) {
    console.error('Error generating AI answer:', error);
    return "I would probably just stand there and stare.";
  }
} 