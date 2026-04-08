<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/b05e6a3d-2919-4bcc-9fec-0f86fe2faad1

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Create a local environment file with your Gemini API key:
   - Copy `.env.example` to `.env.local`
   - Set `GEMINI_API_KEY` in `.env.local`
3. Run the app locally:
   - For the frontend only: `npm run dev`
   - To run the Vercel API locally as well: install Vercel CLI and use `npm run dev:vercel`

## Deploy to Vercel

1. Install the Vercel CLI if you want to deploy from your machine:
   `npm install -g vercel`
2. Set the secret in Vercel:
   - Go to your Vercel dashboard
   - Open the project settings
   - Add an environment variable named `GEMINI_API_KEY`
   - Use the same API key value as in `.env.local`
3. Deploy:
   `vercel --prod`

### Notes for Vercel

- This project now includes a serverless API route at `api/generate.ts`.
- The browser calls `/api/generate`, so your Gemini API key stays server-side and is not exposed in client code.
- `vercel.json` is configured to build the Vite app and route API requests correctly.
