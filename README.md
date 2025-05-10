# What Would You Do? (WWYD)

A multiplayer game where players answer thought-provoking questions and an AI judge determines the best responses.

## Features

- Real-time multiplayer game with socket.io
- AI-powered judging of player answers
- Synchronized countdown timer for answering questions
- Mobile-friendly responsive design
- Room-based gameplay with host controls
- Score tracking and game history

## Getting Started

### Prerequisites

- Node.js (v16 or later)
- MongoDB database
- AI provider API key (HuggingFace, etc.)

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/JasonB101/wwyd.git
   cd wwyd
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env.local` file in the root directory with the following variables:
   ```
   MONGODB_URI=your_mongodb_connection_string
   HF_API_KEY=your_huggingface_api_key
   COHERE_API_KEY=your_api_key_here
   GEMINI_API_KEY=your_api_key_here
   ```

4. Start the development server:
   ```
   npm run dev
   ```

5. Open your browser to `http://localhost:3000`

## Game Flow

1. A host creates a new game room
2. Players join the room with a unique nickname
3. The host starts the game when all players have joined
4. In each round:
   - A thought-provoking question is presented
   - Players have 3 minutes to submit their answers
   - The AI judges the answers based on creativity, humor, or other criteria
   - Points are awarded to the winning answer(s)
   - The host advances to the next round
5. After all rounds, final scores are displayed

## Tech Stack

- **Frontend**: Next.js, React, TypeScript, Tailwind CSS
- **Backend**: Node.js, Socket.io, MongoDB/Mongoose
- **AI**: HuggingFace API integration

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## AI Question Generation

This game uses Google's Gemini AI for generating creative questions and judging player answers. To enable this feature:

1. Sign up for a free account at [Google AI Studio](https://aistudio.google.com/)
2. Create an API key in the Google AI Studio dashboard
3. Add your API key to the `.env.local` file:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```

The free tier includes 60 requests per minute, which is more than enough for gameplay.

If the API is unavailable or you don't set up a key, the game will automatically fall back to using a pre-defined set of questions.
