import { AIProvider } from '../types';

const mockQuestions = [
  "What would you do if you found a magic lamp?",
  "What would you do if you could speak to animals?",
  "What would you do if you discovered a secret door in your house?",
  "What would you do if you could time travel for one day?",
  "What would you do if you could read minds?",
  "What would you do if you woke up with the ability to fly?",
  "What would you do if you found a treasure map in your backyard?",
  "What would you do if you could become invisible for a day?",
  "What would you do if you could talk to plants?",
  "What would you do if you found a genie in a bottle?",
  "What would you do if you could breathe underwater?",
  "What would you do if you could control the weather?",
  "What would you do if you could teleport anywhere?",
  "What would you do if you could speak any language?",
  "What would you do if you could make any food appear instantly?"
];

const mockAnswers = [
  "I would wish for unlimited wishes, of course!",
  "I would ask my cat why she's always judging me.",
  "I would probably just stand there and stare.",
  "I would go back to yesterday and eat that last slice of pizza.",
  "I would try to figure out what my dog is really thinking about.",
  "I would fly to the top of Mount Everest and take a selfie.",
  "I would follow it immediately, but bring snacks for the journey.",
  "I would sneak into a movie theater and watch all the new releases.",
  "I would ask my houseplants why they keep dying despite my best efforts.",
  "I would wish for more genies, creating an infinite wish loop!",
  "I would explore the ocean and make friends with dolphins.",
  "I would make it rain chocolate and snow cotton candy.",
  "I would visit every country in the world for lunch.",
  "I would eavesdrop on conversations in different languages.",
  "I would have a never-ending buffet of my favorite foods."
];

const mockPersonalities = [
  "adventurous",
  "cautious",
  "humorous",
  "practical",
  "creative",
  "logical",
  "impulsive",
  "thoughtful"
];

export class MockAIProvider implements AIProvider {
  private getRandomItem<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  private generatePersonalityBasedAnswer(question: string): string {
    const personality = this.getRandomItem(mockPersonalities);
    const baseAnswer = this.getRandomItem(mockAnswers);

    switch (personality) {
      case "adventurous":
        return `I would immediately jump into action and ${baseAnswer.toLowerCase()}`;
      case "cautious":
        return `After careful consideration, I would probably ${baseAnswer.toLowerCase()}`;
      case "humorous":
        return `Well, I'd probably ${baseAnswer.toLowerCase()} - but only if I could do it while wearing a silly hat!`;
      case "practical":
        return `The most efficient solution would be to ${baseAnswer.toLowerCase()}`;
      case "creative":
        return `I'd put my own spin on it and ${baseAnswer.toLowerCase()}`;
      case "logical":
        return `Based on the available options, I would ${baseAnswer.toLowerCase()}`;
      case "impulsive":
        return `Without thinking twice, I'd ${baseAnswer.toLowerCase()}`;
      case "thoughtful":
        return `I'd take some time to reflect, then ${baseAnswer.toLowerCase()}`;
      default:
        return baseAnswer;
    }
  }

  async generateQuestion(): Promise<string> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    return this.getRandomItem(mockQuestions);
  }

  async generateAnswer(question: string): Promise<string> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 800));
    return this.generatePersonalityBasedAnswer(question);
  }
} 